package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lulalulaluobo/macbox/pkg/auth"
)

func TestHealthIsRestrictedToDirectLoopback(t *testing.T) {
	s := &Server{mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	for _, remote := range []string{"127.0.0.1:4000", "192.168.2.10:4000"} {
		r := httptest.NewRequest("GET", "/api/health", nil)
		r.RemoteAddr = remote
		r.Header.Set("X-Forwarded-For", "127.0.0.1")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		want := http.StatusUnauthorized
		if remote == "127.0.0.1:4000" {
			want = http.StatusOK
		}
		if w.Code != want {
			t.Fatalf("%s: status %d", remote, w.Code)
		}
	}
}

func TestUpdateRoutesRequireAdministrator(t *testing.T) {
	s := &Server{mux: http.NewServeMux()}
	s.registerRoutes()
	for _, path := range []string{"/api/system/update/start", "/api/system/update/rollback", "/api/system/update/check", "/api/vm/network/setup"} {
		r := requestWithUser(&auth.User{ID: "user", Role: "user", Enabled: true})
		r.URL.Path = path
		w := httptest.NewRecorder()
		s.mux.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: status %d", path, w.Code)
		}
	}
}
