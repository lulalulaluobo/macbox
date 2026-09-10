package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/luluen/mac-nas/pkg/config"
)

func getProjectRoot() string {
	_, filename, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))
}

func TestAPIRoutes(t *testing.T) {
	cfg := config.DefaultConfig()
	root := getProjectRoot()
	server := NewServer(cfg, root)
	handler := server.Handler()

	// 1. Test GET /api/system/status
	req := httptest.NewRequest("GET", "/api/system/status", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var statusResp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &statusResp); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}

	if _, ok := statusResp["system"]; !ok {
		t.Errorf("missing 'system' in status response")
	}
	if _, ok := statusResp["vm"]; !ok {
		t.Errorf("missing 'vm' in status response")
	}

	// 2. Test GET /api/storage/disks
	req = httptest.NewRequest("GET", "/api/storage/disks", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	// 3. Test GET /api/apps
	req = httptest.NewRequest("GET", "/api/apps", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
	var apps []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &apps); err == nil {
		if len(apps) < 3 {
			t.Errorf("expected at least 3 preset apps, got %d", len(apps))
		}
	}

	// 4. Test GET /api/samba/status
	req = httptest.NewRequest("GET", "/api/samba/status", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
}
