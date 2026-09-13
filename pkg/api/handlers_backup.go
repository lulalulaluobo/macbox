package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/backup"
	"github.com/lulalulaluobo/macbox/pkg/config"
)

func (s *Server) handleSystemBackupExport(w http.ResponseWriter, _ *http.Request) {
	var output bytes.Buffer
	if _, err := backup.Create(&output); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("创建备份失败: %v", err))
		return
	}

	filename := fmt.Sprintf("macbox-backup-%s.macbox-backup.zip", time.Now().Format("20060102-150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", output.Len()))
	_, _ = w.Write(output.Bytes())
}

func (s *Server) handleSystemBackupRestore(w http.ResponseWriter, r *http.Request) {
	if s.authMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
		return
	}
	if s.authMgr.NeedsSetup() {
		if !s.isLoopbackRequest(r) {
			writeError(w, http.StatusForbidden, "首次恢复配置仅允许在运行 MacBox 的 Mac 本机执行")
			return
		}
	} else if s.requireAdmin(w, r) == nil {
		return
	}

	s.backupRestoreMu.Lock()
	defer s.backupRestoreMu.Unlock()

	if s.vmMgr != nil {
		vmStatus, err := s.vmMgr.GetStatusContext(r.Context())
		if err == nil && vmStatus != nil && vmStatus.Status == "Running" {
			writeError(w, http.StatusConflict, "恢复前请先停止虚拟机，避免运行中的服务继续使用旧配置")
			return
		}
	}

	r.Body = http.MaxBytesReader(w, r.Body, backup.MaxArchiveBytes+1<<20)
	if err := r.ParseMultipartForm(backup.MaxArchiveBytes + 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, "读取备份上传内容失败")
		return
	}
	file, _, err := r.FormFile("backup")
	if err != nil {
		writeError(w, http.StatusBadRequest, "请选择 MacBox 备份文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, backup.MaxArchiveBytes+1))
	if err != nil || len(data) > backup.MaxArchiveBytes {
		writeError(w, http.StatusBadRequest, "备份文件读取失败或超过大小限制")
		return
	}
	archive, err := backup.Read(data)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	restoredConfig, err := config.Parse(archive.Files[backup.ConfigEntryPath])
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("备份中的系统配置无效: %v", err))
		return
	}
	if err := validateCustomAppEntries(archive.Files); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	oldConfig, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "无法读取当前 MacBox 配置")
		return
	}
	// Apply the optional custom-app files before replacing the authentication
	// state. Once users are replaced, every current session is revoked; keeping
	// that as the last stateful step means a filesystem failure cannot leave a
	// partially restored login state in memory.
	if err := restoreCustomApps(archive.Files); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("恢复自定义应用失败: %v", err))
		return
	}

	if err := config.SaveConfig(restoredConfig); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存恢复后的配置失败: %v", err))
		return
	}
	*s.cfg = *restoredConfig
	if err := s.authMgr.ReplaceUsersJSON(archive.Files[backup.UsersEntryPath]); err != nil {
		_ = config.SaveConfig(oldConfig)
		*s.cfg = *oldConfig
		writeError(w, http.StatusBadRequest, fmt.Sprintf("恢复用户数据失败: %v", err))
		return
	}

	if s.vmMgr != nil {
		s.vmMgr.SetConfigDirty(true)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "restored",
		"message":         "配置和用户已恢复。请重新登录，并在需要时重新选择本机数据盘；当前数据文件不会被覆盖。",
		"requiresReLogin": true,
		"includes":        archive.Manifest.Includes,
	})
}

func validateCustomAppEntries(files map[string][]byte) error {
	for name := range files {
		if !strings.HasPrefix(name, backup.CustomAppsEntryPrefix) {
			continue
		}
		relative := strings.TrimPrefix(name, backup.CustomAppsEntryPrefix)
		if relative == "" || filepath.Base(relative) != relative || !strings.HasSuffix(relative, ".json") || strings.HasPrefix(relative, ".") {
			return fmt.Errorf("备份中的自定义应用文件名无效: %s", name)
		}
		if !json.Valid(files[name]) {
			return fmt.Errorf("备份中的自定义应用文件内容无效: %s", name)
		}
	}
	return nil
}

func restoreCustomApps(files map[string][]byte) error {
	appDir, err := backup.ApplicationDataDir()
	if err != nil {
		return err
	}
	customDir := filepath.Join(appDir, "custom_apps")
	if info, statErr := os.Lstat(customDir); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("自定义应用目录不是安全的普通目录")
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	if err := os.MkdirAll(customDir, 0700); err != nil {
		return err
	}
	if err := os.Chmod(customDir, 0700); err != nil {
		return err
	}

	names := make([]string, 0)
	for name := range files {
		if strings.HasPrefix(name, backup.CustomAppsEntryPrefix) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		relative := strings.TrimPrefix(name, backup.CustomAppsEntryPrefix)
		target := filepath.Join(customDir, relative)
		tmpFile, err := os.CreateTemp(customDir, ".restore-custom-app-*.json")
		if err != nil {
			return err
		}
		tmpPath := tmpFile.Name()
		if err := tmpFile.Chmod(0600); err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
			return err
		}
		if _, err := tmpFile.Write(files[name]); err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
			return err
		}
		if err := tmpFile.Close(); err != nil {
			_ = os.Remove(tmpPath)
			return err
		}
		if err := os.Rename(tmpPath, target); err != nil {
			_ = os.Remove(tmpPath)
			return err
		}
		if err := os.Chmod(target, 0600); err != nil {
			return err
		}
	}
	return nil
}
