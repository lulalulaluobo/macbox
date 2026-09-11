package api

import (
	"encoding/json"
	"fmt"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/storage"
	"log"
	"net/http"
)

func (s *Server) handleStorageDisks(w http.ResponseWriter, r *http.Request) {
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取存储配置失败")
		return
	}
	disks, err := storage.ListDisksContext(r.Context(), cfgSnapshot.Storage.SelectedDisk, cfgSnapshot.Storage.SecondaryDisk)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	managed, managedErr := storage.ListManagedDisksContext(r.Context())
	if managedErr != nil {
		if r.Context().Err() != nil {
			writeError(w, http.StatusRequestTimeout, "读取存储状态已取消")
			return
		}
		// A broken external image can make `limactl disk list` fail even though
		// physical disks and the configured binding are still readable. Keep
		// those parts available so the user can open storage settings and
		// unbind/restore the internal backup.
		log.Printf("[MacNAS Storage] managed disk discovery failed; returning degraded storage status: %v", managedErr)
		managed = []storage.ManagedDisk{}
	}

	isExternal := (cfgSnapshot.Storage.DataPath != "")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"disks":            disks,
		"managedDisks":     managed,
		"selectedDisk":     cfgSnapshot.Storage.SelectedDisk,
		"secondaryDisk":    cfgSnapshot.Storage.SecondaryDisk,
		"secondaryMount":   cfgSnapshot.Storage.SecondaryMount,
		"isExternalActive": isExternal,
		"dataPath":         cfgSnapshot.Storage.DataPath,
		"mountPoint":       cfgSnapshot.Storage.MountPoint,
	})
}

func (s *Server) handleStorageBind(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	var req struct {
		Identifier string `json:"identifier"`
		MountPoint string `json:"mountPoint"`
		SizeGB     int    `json:"sizeGB"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	imgPath, err := storage.BindExternalDiskContext(r.Context(), s.cfg, req.Identifier, req.MountPoint, req.SizeGB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         "外接盘已成功绑定为 NAS 数据镜像，重启虚拟机后生效",
		"dataPath":        imgPath,
		"requiresRestart": true,
	})
}

func (s *Server) handleStorageUnbind(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	if err := storage.UnbindExternalDisk(s.cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         "已解除外接盘绑定，切回内置虚拟数据盘",
		"requiresRestart": true,
	})
}

func (s *Server) handleStorageBindSecondary(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	var req struct {
		DiskID      string `json:"diskId"`
		MountPoint  string `json:"mountPoint"`
		TargetDir   string `json:"targetDir"`
		GuestTarget string `json:"guestTarget"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	previousConfig, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取当前存储配置失败")
		return
	}

	res, err := storage.BindSecondaryDiskContext(r.Context(), s.cfg, req.DiskID, req.MountPoint, req.TargetDir, req.GuestTarget, s.projectRoot, s.vmMgr.InstanceName())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := s.regenerateVMConfig(); err != nil {
		if restoreErr := s.restoreConfigSnapshot(previousConfig); restoreErr != nil {
			log.Printf("[MacNAS Storage] 回滚第二存储卷配置失败: %v", restoreErr)
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存后重新生成虚拟机配置失败: %v", err))
		return
	}
	s.vmMgr.SetConfigDirty(true)
	s.scheduleMountSync()

	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleStorageUnbindSecondary(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	previousConfig, snapshotErr := config.Snapshot(s.cfg)
	if snapshotErr != nil {
		writeError(w, http.StatusInternalServerError, "读取当前存储配置失败")
		return
	}
	err := storage.UnbindSecondaryDisk(s.cfg, s.projectRoot, s.vmMgr.InstanceName())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := s.regenerateVMConfig(); err != nil {
		if restoreErr := s.restoreConfigSnapshot(previousConfig); restoreErr != nil {
			log.Printf("[MacNAS Storage] 回滚第二存储卷配置失败: %v", restoreErr)
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存后重新生成虚拟机配置失败: %v", err))
		return
	}
	s.vmMgr.SetConfigDirty(true)
	s.scheduleMountSync()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         "已成功解除第二存储卷绑定",
		"requiresRestart": true,
	})
}

func (s *Server) handleStorageMountsList(w http.ResponseWriter, r *http.Request) {
	configured, recommended := storage.ListLocalMounts(s.cfg)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"mounts":      configured,
		"recommended": recommended,
	})
}

func (s *Server) handleStorageMountsAdd(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	var mount config.LocalMount
	if err := json.NewDecoder(r.Body).Decode(&mount); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	previousConfig, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取当前存储配置失败")
		return
	}

	if err := storage.AddOrUpdateLocalMount(s.cfg, mount); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.regenerateVMConfig(); err != nil {
		if restoreErr := s.restoreConfigSnapshot(previousConfig); restoreErr != nil {
			log.Printf("[MacNAS Storage] 回滚直通目录配置失败: %v", restoreErr)
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存后重新生成虚拟机配置失败: %v", err))
		return
	}

	s.vmMgr.SetConfigDirty(true)
	s.scheduleMountSync()
	configured, recommended := storage.ListLocalMounts(s.cfg)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         fmt.Sprintf("已成功配置直通目录: %s", mount.Name),
		"mounts":          configured,
		"recommended":     recommended,
		"requiresRestart": true,
	})
}

func (s *Server) handleStorageMountsToggle(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	id := r.PathValue("id")
	previousConfig, snapshotErr := config.Snapshot(s.cfg)
	if snapshotErr != nil {
		writeError(w, http.StatusInternalServerError, "读取当前存储配置失败")
		return
	}
	enabled, err := storage.ToggleLocalMount(s.cfg, id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	if err := s.regenerateVMConfig(); err != nil {
		if restoreErr := s.restoreConfigSnapshot(previousConfig); restoreErr != nil {
			log.Printf("[MacNAS Storage] 回滚直通目录配置失败: %v", restoreErr)
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存后重新生成虚拟机配置失败: %v", err))
		return
	}

	s.vmMgr.SetConfigDirty(true)
	s.scheduleMountSync()
	configured, recommended := storage.ListLocalMounts(s.cfg)
	msg := "已开启该直通目录，重启虚拟机后生效"
	if !enabled {
		msg = "已关闭该直通目录，重启虚拟机后生效"
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         msg,
		"enabled":         enabled,
		"mounts":          configured,
		"recommended":     recommended,
		"requiresRestart": true,
	})
}

func (s *Server) handleStorageMountsDelete(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	id := r.PathValue("id")
	previousConfig, snapshotErr := config.Snapshot(s.cfg)
	if snapshotErr != nil {
		writeError(w, http.StatusInternalServerError, "读取当前存储配置失败")
		return
	}
	if err := storage.DeleteLocalMount(s.cfg, id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	if err := s.regenerateVMConfig(); err != nil {
		if restoreErr := s.restoreConfigSnapshot(previousConfig); restoreErr != nil {
			log.Printf("[MacNAS Storage] 回滚直通目录配置失败: %v", restoreErr)
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存后重新生成虚拟机配置失败: %v", err))
		return
	}

	s.vmMgr.SetConfigDirty(true)
	s.scheduleMountSync()
	configured, recommended := storage.ListLocalMounts(s.cfg)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         "已删除该直通目录配置",
		"mounts":          configured,
		"recommended":     recommended,
		"requiresRestart": true,
	})
}

func (s *Server) handleStorageMountsWritable(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	id := r.PathValue("id")
	previousConfig, snapshotErr := config.Snapshot(s.cfg)
	if snapshotErr != nil {
		writeError(w, http.StatusInternalServerError, "读取当前存储配置失败")
		return
	}
	var req struct {
		Writable bool `json:"writable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}

	writable, err := storage.ToggleLocalMountWritable(s.cfg, id, req.Writable)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Try dynamic remount in running VM
	mode := "ro"
	if writable {
		mode = "rw"
	}
	var target string
	currentConfig, configErr := config.Snapshot(s.cfg)
	if configErr != nil {
		writeError(w, http.StatusInternalServerError, "读取当前存储配置失败")
		return
	}
	for _, m := range currentConfig.Storage.LocalMounts {
		if m.ID == id {
			target = m.GuestTarget
			break
		}
	}
	if out, remountErr := s.vmMgr.Exec(r.Context(), "sudo", "mount", "-o", "remount,"+mode, "/mnt/macnas-mounts/"+id); remountErr != nil {
		log.Printf("[MacNAS Storage] 直通目录 remount 未立即生效: %s (%v)", out, remountErr)
	}
	if target != "" {
		if out, remountErr := s.vmMgr.Exec(r.Context(), "sudo", "mount", "-o", "remount,"+mode, "/data/"+target); remountErr != nil {
			log.Printf("[MacNAS Storage] 数据目录 remount 未立即生效: %s (%v)", out, remountErr)
		}
	}

	if err := s.regenerateVMConfig(); err != nil {
		if restoreErr := s.restoreConfigSnapshot(previousConfig); restoreErr != nil {
			log.Printf("[MacNAS Storage] 回滚直通目录配置失败: %v", restoreErr)
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存后重新生成虚拟机配置失败: %v", err))
		return
	}

	s.vmMgr.SetConfigDirty(true)
	s.scheduleMountSync()

	configured, recommended := storage.ListLocalMounts(s.cfg)
	msg := "已切换为只读保护模式，请重启虚拟机以完全同步权限"
	if writable {
		msg = "已切换为允许读写模式，请点击上方提示重启虚拟机以完全同步读写权限"
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         msg,
		"writable":        writable,
		"mounts":          configured,
		"recommended":     recommended,
		"requiresRestart": true,
	})
}
