package api

import (
	"encoding/json"
	"fmt"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/system"
	"net/http"
)

// Samba Handlers
func (s *Server) handleSambaStatus(w http.ResponseWriter, r *http.Request) {
	sysStats, _ := system.GetSystemStats()
	primaryIP := "localhost"
	if sysStats != nil && sysStats.PrimaryIP != "" {
		primaryIP = sysStats.PrimaryIP
	}

	status, err := s.sambaMgr.GetStatus(r.Context(), primaryIP)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleSambaPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	if err := s.sambaMgr.UpdatePassword(r.Context(), body.Password); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "密码修改成功"})
}

func (s *Server) handleSambaShareAddOrUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var share config.SMBShare
	if err := json.NewDecoder(r.Body).Decode(&share); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数解析失败: "+err.Error())
		return
	}
	if id != "" {
		share.ID = id
	}

	result, err := s.sambaMgr.AddOrUpdateShare(r.Context(), share)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "share": result})
}

func (s *Server) handleSambaShareToggle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少共享 ID")
		return
	}
	newState, err := s.sambaMgr.ToggleShare(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "enabled": newState})
}

func (s *Server) handleSambaShareDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少共享 ID")
		return
	}
	if err := s.sambaMgr.DeleteShare(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "共享项已删除"})
}

func (s *Server) handleSambaServiceToggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enable bool `json:"enable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := s.sambaMgr.ToggleService(r.Context(), body.Enable); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	actionStr := "停止"
	if body.Enable {
		actionStr = "启动"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": fmt.Sprintf("Samba 服务已%s", actionStr)})
}

func (s *Server) handleSambaServiceRestart(w http.ResponseWriter, r *http.Request) {
	if err := s.sambaMgr.Restart(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "Samba 服务已重启"})
}
