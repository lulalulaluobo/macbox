package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/luluen/mac-nas/pkg/auth"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/vm"
)

func requestWithUser(user *auth.User) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/protected", nil)
	return req.WithContext(context.WithValue(req.Context(), userContextKey, user))
}

func TestAdminOnlyRequiresAdministrator(t *testing.T) {
	server := &Server{}

	tests := []struct {
		name       string
		request    *http.Request
		wantStatus int
		wantCalled bool
	}{
		{
			name:       "anonymous",
			request:    httptest.NewRequest(http.MethodPost, "/api/protected", nil),
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "regular user",
			request: requestWithUser(&auth.User{
				ID:      "u-user",
				Role:    "user",
				Enabled: true,
			}),
			wantStatus: http.StatusForbidden,
		},
		{
			name: "administrator",
			request: requestWithUser(&auth.User{
				ID:      "u-admin",
				Role:    "admin",
				Enabled: true,
			}),
			wantStatus: http.StatusNoContent,
			wantCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handlerCalled := false
			protected := server.adminOnly(func(w http.ResponseWriter, _ *http.Request) {
				handlerCalled = true
				w.WriteHeader(http.StatusNoContent)
			})
			w := httptest.NewRecorder()
			protected.ServeHTTP(w, tt.request)

			if w.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", tt.wantStatus, w.Code, w.Body.String())
			}
			if handlerCalled != tt.wantCalled {
				t.Fatalf("protected handler called = %v, want %v", handlerCalled, tt.wantCalled)
			}
		})
	}
}

func TestAPIHandlerRequiresAuthentication(t *testing.T) {
	server := &Server{mux: http.NewServeMux()}
	handler := server.Handler()

	request := httptest.NewRequest(http.MethodGet, "/api/system/status", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated API request to return 401, got %d", response.Code)
	}
}

func TestWriteErrorSanitizesInternalDetails(t *testing.T) {
	response := httptest.NewRecorder()
	writeError(response, http.StatusInternalServerError, "/Users/lulu/secret: command output")

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d", response.Code)
	}
	body := response.Body.String()
	if strings.Contains(body, "/Users/lulu/secret") || strings.Contains(body, "command output") {
		t.Fatalf("internal details leaked in error response: %s", body)
	}
	if !strings.Contains(body, "服务器内部错误") {
		t.Fatalf("generic internal error missing from response: %s", body)
	}
}

func TestHandlerSetsSecurityHeaders(t *testing.T) {
	server := &Server{mux: http.NewServeMux()}
	handler := server.Handler()

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))

	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := response.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if csp := response.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Fatalf("missing restrictive CSP: %q", csp)
	}
}

func TestStorageOperationLockRejectsConcurrentMutation(t *testing.T) {
	server := &Server{}
	first := httptest.NewRecorder()
	if !server.beginStorageOperation(first) {
		t.Fatal("first storage operation should acquire the lock")
	}

	second := httptest.NewRecorder()
	if server.beginStorageOperation(second) {
		t.Fatal("second storage operation should be rejected while the first is active")
	}
	if second.Code != http.StatusConflict {
		t.Fatalf("second storage operation status = %d, want %d", second.Code, http.StatusConflict)
	}
	server.endStorageOperation()

	third := httptest.NewRecorder()
	if !server.beginStorageOperation(third) {
		t.Fatal("storage operation should be available after release")
	}
	server.endStorageOperation()
}

func TestDockerOperationLockRejectsConcurrentMutation(t *testing.T) {
	server := &Server{}
	first := httptest.NewRecorder()
	if !server.beginDockerOperation(first) {
		t.Fatal("first Docker operation should acquire the lock")
	}

	second := httptest.NewRecorder()
	if server.beginDockerOperation(second) {
		t.Fatal("second Docker operation should be rejected while the first is active")
	}
	if second.Code != http.StatusConflict {
		t.Fatalf("second Docker operation status = %d, want %d", second.Code, http.StatusConflict)
	}
	server.endDockerOperation()

	third := httptest.NewRecorder()
	if !server.beginDockerOperation(third) {
		t.Fatal("Docker operation should be available after release")
	}
	server.endDockerOperation()
}

func TestRegisterRoutesHasNoConflicts(t *testing.T) {
	server := &Server{mux: http.NewServeMux()}
	server.registerRoutes()
}

func TestPrivilegedRoutesRejectRegularUsers(t *testing.T) {
	server := &Server{mux: http.NewServeMux()}
	server.registerRoutes()

	paths := []string{
		"/api/vm/lima/install",
		"/api/vm/start",
		"/api/docker/compose/example",
		"/api/terminal/files/mkdir",
		"/api/system/root/password",
		"/api/system/ssh",
		"/api/apps/example/config",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			request := requestWithUser(&auth.User{
				ID:      "u-user",
				Role:    "user",
				Enabled: true,
			})
			if path == "/api/system/ssh" || path == "/api/apps/example/config" || path == "/api/docker/compose/example" {
				request.Method = http.MethodGet
			}
			request.URL.Path = path
			response := httptest.NewRecorder()
			server.mux.ServeHTTP(response, request)

			if response.Code != http.StatusForbidden {
				t.Fatalf("expected regular user to receive 403 for %s, got %d: %s", path, response.Code, response.Body.String())
			}
		})
	}
}

func TestHandlerRejectsUnapprovedOrigin(t *testing.T) {
	server := &Server{
		mux:            http.NewServeMux(),
		allowedOrigins: map[string]struct{}{},
	}
	server.registerRoutes()

	request := httptest.NewRequest(http.MethodOptions, "/api/auth/status", nil)
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("unapproved origin status = %d, want 403", response.Code)
	}
}

func TestHandlerAllowsExplicitOriginWithoutWildcard(t *testing.T) {
	const origin = "https://console.example"
	server := &Server{
		mux:            http.NewServeMux(),
		allowedOrigins: map[string]struct{}{origin: {}},
	}
	server.registerRoutes()

	request := httptest.NewRequest(http.MethodOptions, "/api/auth/status", nil)
	request.Header.Set("Origin", origin)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("allowed origin preflight status = %d, want 204", response.Code)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("allow-origin = %q, want %q", got, origin)
	}
	if got := response.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("credentials header = %q, wildcard credential access is not expected", got)
	}
}

func TestAuthSetupRejectsNonLoopbackRequest(t *testing.T) {
	server := &Server{mux: http.NewServeMux()}
	server.registerRoutes()

	request := httptest.NewRequest(http.MethodPost, "/api/auth/setup", nil)
	request.RemoteAddr = "192.0.2.10:1234"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("remote setup status = %d, want 403", response.Code)
	}
}

func TestUntrustedProxyHeadersAreIgnored(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "192.0.2.10:1234"
	request.Header.Set("X-Forwarded-For", "127.0.0.1")
	request.Header.Set("X-Forwarded-Proto", "https")
	if got := server.requestIP(request); got != "192.0.2.10" {
		t.Fatalf("request IP = %q, want direct peer", got)
	}
	if server.requestIsHTTPS(request) {
		t.Fatal("untrusted proxy must not make request HTTPS")
	}
}

func TestTrustedProxyResolvesExternalClient(t *testing.T) {
	server := &Server{trustedProxies: configuredProxies("127.0.0.1/32")}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("X-Forwarded-For", "198.51.100.20")
	request.Header.Set("X-Forwarded-Proto", "https")
	if got := server.requestIP(request); got != "198.51.100.20" {
		t.Fatalf("request IP = %q, want forwarded client", got)
	}
	if server.isLoopbackRequest(request) {
		t.Fatal("external forwarded client must not pass loopback check")
	}
	if !server.requestIsHTTPS(request) {
		t.Fatal("trusted proxy HTTPS signal should be honored")
	}
}

func TestTrustedProxyWithoutForwardedClientFailsClosed(t *testing.T) {
	server := &Server{trustedProxies: configuredProxies("127.0.0.1/32")}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	if got := server.requestIP(request); got != "unknown" {
		t.Fatalf("request IP = %q, want unknown without forwarded client", got)
	}
	if server.isLoopbackRequest(request) {
		t.Fatal("missing forwarded client must not pass loopback check")
	}
}

func TestComposeDeleteWithVolumesRequiresConfirmation(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodDelete, "/api/docker/compose/media?volumes=true", nil)
	request.SetPathValue("name", "media")
	response := httptest.NewRecorder()
	server.handleDockerComposeDelete(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("unconfirmed volume deletion status = %d, want 400", response.Code)
	}
}

func TestVMHandlerRejectsConcurrentAction(t *testing.T) {
	server := &Server{vmMgr: vm.NewManager(config.DefaultConfig())}
	if !server.vmMgr.BeginVMAction("starting") {
		t.Fatal("failed to set up active VM action")
	}
	defer server.vmMgr.EndVMAction()

	request := httptest.NewRequest(http.MethodPost, "/api/vm/restart", nil)
	response := httptest.NewRecorder()
	server.handleVMRestart(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("concurrent VM action status = %d, want 409", response.Code)
	}
}
