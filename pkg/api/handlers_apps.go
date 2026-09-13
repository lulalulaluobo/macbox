package api

import (
	"encoding/json"
	"fmt"
	"github.com/lulalulaluobo/macbox/pkg/apps"
	"github.com/lulalulaluobo/macbox/pkg/docker"
	"github.com/lulalulaluobo/macbox/pkg/system"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// Apps Handlers
func (s *Server) handleAppsList(w http.ResponseWriter, r *http.Request) {
	sysStats, _ := system.GetSystemStats()
	primaryIP := "localhost"
	if sysStats != nil && sysStats.PrimaryIP != "" {
		primaryIP = sysStats.PrimaryIP
	}

	appList, err := s.appMgr.ListApps(r.Context(), primaryIP)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, appList)
}

func (s *Server) handleAppInstall(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.appMgr.Install(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "应用安装成功"})
}

type appSSEWriter struct {
	mu        sync.Mutex
	w         http.ResponseWriter
	flusher   http.Flusher
	bytesSent int64
	truncated bool
}

const maxSSEOutputBytes int64 = 4 << 20

func (sw *appSSEWriter) Write(p []byte) (n int, err error) {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	if sw.bytesSent >= maxSSEOutputBytes {
		if !sw.truncated {
			sw.truncated = true
			if _, err := fmt.Fprint(sw.w, "data: [输出已截断，日志超过 4 MiB 上限]\n\n"); err != nil {
				return 0, err
			}
			sw.flusher.Flush()
		}
		return len(p), nil
	}

	visible := p
	if remaining := maxSSEOutputBytes - sw.bytesSent; int64(len(visible)) > remaining {
		visible = visible[:remaining]
		sw.truncated = true
	}
	sw.bytesSent += int64(len(visible))
	lines := strings.Split(string(visible), "\n")
	for _, line := range lines {
		trimmed := strings.TrimRight(line, "\r")
		if trimmed != "" {
			if _, err := fmt.Fprintf(sw.w, "data: %s\n\n", trimmed); err != nil {
				return 0, err
			}
		}
	}
	if sw.truncated && int64(len(visible)) < int64(len(p)) {
		if _, err := fmt.Fprint(sw.w, "data: [输出已截断，日志超过 4 MiB 上限]\n\n"); err != nil {
			return 0, err
		}
	}
	sw.flusher.Flush()
	return len(p), nil
}

// writeSSEEvent serializes event payloads as JSON so command output or user
// input cannot break the SSE framing with newlines or unescaped quotes.
func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, event string, payload interface{}) error {
	if event == "" || strings.ContainsAny(event, "\r\n") {
		return fmt.Errorf("invalid SSE event name")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func (s *Server) handleAppGetConfig(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, err := s.appMgr.GetAppConfig(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

func (s *Server) handleAppInstallCustomStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	id := r.PathValue("id")

	var cfg apps.InstallCustomConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}

	ctx := r.Context()
	err := s.appMgr.InstallStreamCustom(ctx, id, cfg, sw)
	if err != nil {
		log.Printf("[MacBox] custom app install stream failed for %q: %v", id, err)
		_ = writeSSEEvent(w, flusher, "error", map[string]string{"error": "应用安装失败"})
	} else {
		_ = writeSSEEvent(w, flusher, "done", map[string]string{"status": "success", "id": id})
	}
}

func (s *Server) handleAppCustomAdd(w http.ResponseWriter, r *http.Request) {
	var req apps.CustomAppInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	meta, err := s.appMgr.AddCustomApp(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

func (s *Server) handleAppCustomDelete(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.appMgr.DeleteCustomApp(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppStoreSync(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	count, err := s.appMgr.SyncCommunityStore(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"count":  count,
	})
}

func (s *Server) handleAppStart(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.appMgr.Start(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppStop(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.appMgr.Stop(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppRestart(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.appMgr.Restart(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppUninstall(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.appMgr.Uninstall(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "应用已卸载"})
}

func (s *Server) handleAppLogs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tailStr := r.URL.Query().Get("tail")
	tail := docker.NormalizeLogTail(0)
	if n, err := strconv.Atoi(tailStr); err == nil && n > 0 {
		tail = docker.NormalizeLogTail(n)
	}
	logs, err := s.appMgr.GetLogs(r.Context(), id, tail)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": logs})
}
