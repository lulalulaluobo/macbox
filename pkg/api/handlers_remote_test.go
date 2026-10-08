package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lulalulaluobo/macbox/pkg/auth"
)

func TestTailscaleRoutesRequireAdministrator(t *testing.T) {
	s := &Server{mux: http.NewServeMux()}
	s.registerRoutes()
	for _, path := range []string{"/api/remote/tailscale", "/api/remote/tailscale/install", "/api/remote/tailscale/connect", "/api/remote/tailscale/pause", "/api/remote/tailscale/logout"} {
		method := http.MethodPost
		if path == "/api/remote/tailscale" {
			method = http.MethodGet
		}
		req := requestWithUser(&auth.User{ID: "regular", Role: "user", Enabled: true})
		req.Method = method
		req.URL.Path = path
		response := httptest.NewRecorder()
		s.mux.ServeHTTP(response, req)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s: status=%d", path, response.Code)
		}
	}
}

func TestRemoteAddressKeepsOriginAndAuthenticationChecks(t *testing.T) {
	s := &Server{mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /api/remote/tailscale", func(w http.ResponseWriter, _ *http.Request) { t.Fatal("anonymous request reached remote handler") })
	for _, origin := range []string{"http://100.100.0.2:19808", "https://untrusted.example"} {
		req := httptest.NewRequest(http.MethodGet, "http://100.100.0.2:19808/api/remote/tailscale", nil)
		req.Header.Set("Origin", origin)
		res := httptest.NewRecorder()
		s.Handler().ServeHTTP(res, req)
		want := http.StatusUnauthorized
		if origin == "https://untrusted.example" {
			want = http.StatusForbidden
		}
		if res.Code != want {
			t.Fatalf("origin %s: got %d want %d", origin, res.Code, want)
		}
	}
}
