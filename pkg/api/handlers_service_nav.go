package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/lulalulaluobo/macbox/pkg/config"
)

var errServiceShortcutNotFound = errors.New("服务导航不存在")
var errServiceShortcutAlreadyExists = errors.New("服务导航已存在")
var errServiceShortcutReorderInvalid = errors.New("服务导航排序数据无效")

type serviceShortcutReorderRequest struct {
	IDs []string `json:"ids"`
}

func newManualServiceShortcutID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成服务导航 ID 失败: %w", err)
	}
	return "manual:" + hex.EncodeToString(buf), nil
}

func normalizeServiceShortcutInput(shortcut config.ServiceShortcut, allowGenerateID bool) (config.ServiceShortcut, error) {
	shortcut.ID = strings.TrimSpace(shortcut.ID)
	shortcut.Source = strings.ToLower(strings.TrimSpace(shortcut.Source))
	shortcut.ContainerID = strings.TrimSpace(shortcut.ContainerID)
	shortcut.ContainerName = strings.TrimSpace(shortcut.ContainerName)
	shortcut.Name = strings.TrimSpace(shortcut.Name)
	shortcut.URL = strings.TrimSpace(shortcut.URL)
	shortcut.Icon = strings.TrimSpace(shortcut.Icon)
	shortcut.Description = strings.TrimSpace(shortcut.Description)
	if shortcut.Source == "" {
		shortcut.Source = "manual"
	}
	if allowGenerateID && shortcut.ID == "" {
		id, err := newManualServiceShortcutID()
		if err != nil {
			return shortcut, err
		}
		shortcut.ID = id
	}
	if err := config.ValidateServiceShortcut(shortcut); err != nil {
		return shortcut, err
	}
	return shortcut, nil
}

func (s *Server) handleServiceShortcutsList(w http.ResponseWriter, _ *http.Request) {
	cfg, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("读取服务导航失败: %v", err))
		return
	}
	shortcuts := cfg.ServiceNav
	if shortcuts == nil {
		shortcuts = []config.ServiceShortcut{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"shortcuts": shortcuts})
}

func (s *Server) handleServiceShortcutCreate(w http.ResponseWriter, r *http.Request) {
	var shortcut config.ServiceShortcut
	if err := json.NewDecoder(r.Body).Decode(&shortcut); err != nil {
		writeError(w, http.StatusBadRequest, "服务导航数据格式不正确")
		return
	}
	shortcut, err := normalizeServiceShortcutInput(shortcut, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := config.Update(s.cfg, func(cfg *config.Config) error {
		for _, existing := range cfg.ServiceNav {
			if existing.ID == shortcut.ID {
				return errServiceShortcutAlreadyExists
			}
		}
		cfg.ServiceNav = append(cfg.ServiceNav, shortcut)
		return nil
	}); err != nil {
		if errors.Is(err, errServiceShortcutAlreadyExists) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存服务导航失败: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "created", "shortcut": shortcut})
}

func (s *Server) handleServiceShortcutUpdate(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "服务导航 ID 不能为空")
		return
	}
	var shortcut config.ServiceShortcut
	if err := json.NewDecoder(r.Body).Decode(&shortcut); err != nil {
		writeError(w, http.StatusBadRequest, "服务导航数据格式不正确")
		return
	}
	shortcut.ID = id
	shortcut, err := normalizeServiceShortcutInput(shortcut, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := config.Update(s.cfg, func(cfg *config.Config) error {
		for index := range cfg.ServiceNav {
			if cfg.ServiceNav[index].ID == id {
				cfg.ServiceNav[index] = shortcut
				return nil
			}
		}
		return errServiceShortcutNotFound
	}); err != nil {
		if errors.Is(err, errServiceShortcutNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存服务导航失败: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "updated", "shortcut": shortcut})
}

func (s *Server) handleServiceShortcutDelete(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "服务导航 ID 不能为空")
		return
	}
	if err := config.Update(s.cfg, func(cfg *config.Config) error {
		for index := range cfg.ServiceNav {
			if cfg.ServiceNav[index].ID == id {
				cfg.ServiceNav = append(cfg.ServiceNav[:index], cfg.ServiceNav[index+1:]...)
				return nil
			}
		}
		return errServiceShortcutNotFound
	}); err != nil {
		if errors.Is(err, errServiceShortcutNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("删除服务导航失败: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleServiceShortcutReorder(w http.ResponseWriter, r *http.Request) {
	var req serviceShortcutReorderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "服务导航排序数据格式不正确")
		return
	}
	if err := config.Update(s.cfg, func(cfg *config.Config) error {
		if len(req.IDs) != len(cfg.ServiceNav) {
			return fmt.Errorf("%w: 排序必须包含全部服务导航", errServiceShortcutReorderInvalid)
		}
		byID := make(map[string]config.ServiceShortcut, len(cfg.ServiceNav))
		for _, shortcut := range cfg.ServiceNav {
			byID[shortcut.ID] = shortcut
		}
		ordered := make([]config.ServiceShortcut, 0, len(req.IDs))
		seen := make(map[string]struct{}, len(req.IDs))
		for _, id := range req.IDs {
			if _, exists := seen[id]; exists {
				return fmt.Errorf("%w: 排序包含重复服务导航", errServiceShortcutReorderInvalid)
			}
			shortcut, exists := byID[id]
			if !exists {
				return fmt.Errorf("%w: 排序包含未知服务导航", errServiceShortcutReorderInvalid)
			}
			seen[id] = struct{}{}
			ordered = append(ordered, shortcut)
		}
		cfg.ServiceNav = ordered
		return nil
	}); err != nil {
		if errors.Is(err, errServiceShortcutReorderInvalid) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存服务导航排序失败: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "reordered"})
}
