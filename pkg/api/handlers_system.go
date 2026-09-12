package api

import (
	"encoding/json"
	"fmt"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/docker"
	"github.com/luluen/mac-nas/pkg/storage"
	"github.com/luluen/mac-nas/pkg/system"
	"github.com/luluen/mac-nas/pkg/vm"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// System Status Overview (Parallelized for low latency)
func (s *Server) handleSystemStatus(w http.ResponseWriter, r *http.Request) {
	cfgSnapshot, cfgErr := config.Snapshot(s.cfg)
	if cfgErr != nil {
		log.Printf("[MacNAS] system status config snapshot failed: %v", cfgErr)
		writeError(w, http.StatusInternalServerError, "读取系统配置失败")
		return
	}
	var (
		sysStats           *system.SystemStats
		sysErr             error
		vmStat             *vm.VMStatus
		vmErr              error
		containers         []docker.ContainerInfo
		dockerErr          error
		dockerRunningCount int
		selectedDisk       *storage.DiskInfo
		disks              []storage.DiskInfo
		storageErr         error
		wg                 sync.WaitGroup
	)

	wg.Add(4)

	// 1. Host system stats
	go func() {
		defer wg.Done()
		sysStats, sysErr = system.GetSystemStats()
	}()

	// 2. VM status
	go func() {
		defer wg.Done()
		vmStat, vmErr = s.vmMgr.GetStatusContext(r.Context())
	}()

	// 3. Docker containers
	go func() {
		defer wg.Done()
		containers, dockerErr = s.dockerClient.ListContainers(r.Context())
		if dockerErr != nil {
			return
		}
		for _, c := range containers {
			if c.State == "running" {
				dockerRunningCount++
			}
		}
	}()

	// 4. Storage overview
	go func() {
		defer wg.Done()
		disks, storageErr = storage.ListDisksContext(r.Context(), cfgSnapshot.Storage.SelectedDisk, cfgSnapshot.Storage.SecondaryDisk)
		if storageErr != nil {
			return
		}
		for _, d := range disks {
			if d.IsSelected {
				diskCopy := d
				selectedDisk = &diskCopy
				break
			}
		}
	}()

	wg.Wait()

	if sysErr != nil {
		writeError(w, http.StatusInternalServerError, sysErr.Error())
		return
	}

	statusErrors := make(map[string]string)
	if vmErr != nil {
		log.Printf("[MacNAS] system status VM error: %v", vmErr)
		statusErrors["vm"] = "unavailable"
	}
	if dockerErr != nil {
		log.Printf("[MacNAS] system status Docker error: %v", dockerErr)
		statusErrors["docker"] = "unavailable"
	}
	if storageErr != nil {
		log.Printf("[MacNAS] system status storage error: %v", storageErr)
		statusErrors["storage"] = "unavailable"
	}

	resp := map[string]interface{}{
		"system":                 sysStats,
		"power":                  s.powerMgr.GetStatus(),
		"service":                s.serviceMgr.GetStatus(),
		"vm":                     vmStat,
		"vmAction":               s.vmMgr.GetVMAction(),
		"configDirty":            s.vmMgr.IsConfigDirty(),
		"initializationRequired": !cfgSnapshot.System.InitializationCompleted,
		"docker": map[string]interface{}{
			"ready":        vmStat != nil && vmStat.DockerReady,
			"total":        len(containers),
			"runningCount": dockerRunningCount,
		},
		"storage": map[string]interface{}{
			"selectedDisk":     selectedDisk,
			"diskCount":        len(disks),
			"isExternalActive": cfgSnapshot.Storage.DataPath != "",
			"dataPath":         cfgSnapshot.Storage.DataPath,
			"mountPoint":       cfgSnapshot.Storage.MountPoint,
		},
		"timestamp": time.Now(),
	}
	if len(statusErrors) > 0 {
		resp["degraded"] = true
		resp["errors"] = statusErrors
	}

	writeJSON(w, http.StatusOK, resp)
}

// Power Management Handlers
func (s *Server) handleSystemPower(w http.ResponseWriter, r *http.Request) {
	status := s.powerMgr.GetStatus()
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleSystemPowerToggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enable bool `json:"enable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := s.powerMgr.SetPreventSleep(body.Enable); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, s.powerMgr.GetStatus())
}

// Service Management Handlers
func (s *Server) handleSystemServiceStatus(w http.ResponseWriter, r *http.Request) {
	status := s.serviceMgr.GetStatus()
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleSystemServiceInstall(w http.ResponseWriter, r *http.Request) {
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取系统配置失败")
		return
	}
	port := cfgSnapshot.Port
	if port <= 0 {
		port = 19808
	}
	if err := s.serviceMgr.Install(port); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.serviceMgr.GetStatus())
}

func (s *Server) handleSystemServiceUninstall(w http.ResponseWriter, r *http.Request) {
	if err := s.serviceMgr.Uninstall(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.serviceMgr.GetStatus())
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.userMgr.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		IsSudo   bool   `json:"isSudo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	if err := s.userMgr.CreateUser(r.Context(), req.Username, req.Password, req.IsSudo); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("用户 %s 创建成功", req.Username),
	})
}

func (s *Server) handleUpdateUserPassword(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	if err := s.userMgr.UpdateUserPassword(r.Context(), username, req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("用户 %s 密码修改成功", username),
	})
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	if err := s.userMgr.DeleteUser(r.Context(), username); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("用户 %s 已被成功删除", username),
	})
}

func (s *Server) handleUpdateRootPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	if err := s.userMgr.UpdateRootPassword(r.Context(), req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "超级管理员 (root) 密码已成功更新",
	})
}

func (s *Server) handleGetSSHConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.sshMgr.GetConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (s *Server) handleBootstrapSSH(w http.ResponseWriter, r *http.Request) {
	if err := s.sshMgr.BootstrapRootKeyOnly(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("初始化 SSH 失败: %v", err))
		return
	}
	if err := config.Update(s.cfg, func(updated *config.Config) error {
		updated.System.InitializationCompleted = true
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("保存初始化状态失败: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "SSH 已配置为 root 密钥登录，密码认证已关闭",
	})
}

func (s *Server) handleUpdateSSHConfig(w http.ResponseWriter, r *http.Request) {
	var req system.SSHConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	if err := s.sshMgr.UpdateConfig(r.Context(), req); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "SSH 配置已更新并成功应用生效",
	})
}

func (s *Server) handleToggleSSH(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enable bool `json:"enable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	if err := s.sshMgr.ToggleService(r.Context(), req.Enable); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	msg := "SSH 服务已启动"
	if !req.Enable {
		msg = "SSH 服务已停止"
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": msg,
	})
}

func (s *Server) handleGetTerminalSettings(w http.ResponseWriter, r *http.Request) {
	settings := s.termSettingsMgr.Get()
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateTerminalSettings(w http.ResponseWriter, r *http.Request) {
	var req system.TerminalSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	if err := s.termSettingsMgr.Update(req); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "终端设置已保存",
	})
}

type terminalSkillsResponse struct {
	Enabled         bool                       `json:"enabled"`
	HostPath        string                     `json:"hostPath"`
	GuestPaths      []string                   `json:"guestPaths"`
	ReadOnly        bool                       `json:"readOnly"`
	Status          string                     `json:"status"`
	Message         string                     `json:"message"`
	RequiresRestart bool                       `json:"requiresRestart"`
	Candidates      []system.AISkillsCandidate `json:"candidates"`
}

func (s *Server) terminalSkillsState() (terminalSkillsResponse, error) {
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		return terminalSkillsResponse{}, err
	}
	path := cfgSnapshot.Terminal.AISkillsHostPath
	result := terminalSkillsResponse{
		Enabled:  cfgSnapshot.Terminal.AISkillsEnabled,
		HostPath: path,
		GuestPaths: []string{
			"/home/macnasctl/.agents/skills", "/root/.agents/skills",
			"/home/macnasctl/.claude/skills", "/root/.claude/skills",
			"/home/macnasctl/.codex/skills", "/root/.codex/skills",
		},
		ReadOnly:   true,
		Status:     "disabled",
		Message:    "未启用本机 Skill 目录映射",
		Candidates: system.DiscoverAISkillsCandidates(),
	}
	if !result.Enabled {
		return result, nil
	}
	if path == "" {
		result.Status = "invalid"
		result.Message = "已启用，但没有配置本机 Skill 目录"
		return result, nil
	}
	info, statErr := os.Stat(path)
	if statErr != nil {
		result.Status = "missing"
		result.Message = "本机目录不存在，请重新挂载磁盘或选择其他 Skill 目录"
		return result, nil
	}
	if !info.IsDir() {
		result.Status = "invalid"
		result.Message = "配置路径不是目录，请选择 .agents/skills 文件夹"
		return result, nil
	}
	resolvedPath, skillCount, resolveErr := system.AISkillsDirectoryInfo(path)
	if resolveErr != nil {
		result.Status = "invalid"
		result.Message = resolveErr.Error()
		return result, nil
	}
	if resolvedPath != path {
		result.HostPath = resolvedPath
		result.Status = "ready"
		result.Message = fmt.Sprintf("已识别到 %d 个 Skill；检测到管理器根目录，实际映射目录已自动下沉到 /skills", skillCount)
		return result, nil
	}
	result.Status = "ready"
	result.Message = fmt.Sprintf("已识别到 %d 个 Skill，本机目录将以只读方式映射到 VM", skillCount)
	return result, nil
}

func (s *Server) handleGetTerminalSkills(w http.ResponseWriter, _ *http.Request) {
	result, err := s.terminalSkillsState()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取 AI Skill 映射设置失败")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleUpdateTerminalSkills(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled     bool   `json:"enabled"`
		HostPath    string `json:"hostPath"`
		ConfirmRisk bool   `json:"confirmRisk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	hostPath, err := config.NormalizeAISkillsHostPath(req.HostPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Enabled {
		if !req.ConfirmRisk {
			writeError(w, http.StatusBadRequest, "请确认 Skill 目录可能包含本机敏感文件，映射将以只读方式暴露给 VM/AI CLI")
			return
		}
		if hostPath == "" {
			writeError(w, http.StatusBadRequest, "请先选择本机 AI Skill 目录")
			return
		}
		info, statErr := os.Stat(hostPath)
		if os.IsNotExist(statErr) {
			writeError(w, http.StatusBadRequest, "本机 Skill 目录不存在，请先创建或重新挂载目录")
			return
		}
		if statErr != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("无法读取本机 Skill 目录: %v", statErr))
			return
		}
		if !info.IsDir() {
			writeError(w, http.StatusBadRequest, "AI Skill 路径必须是目录")
			return
		}
		resolvedPath, _, resolveErr := system.AISkillsDirectoryInfo(hostPath)
		if resolveErr != nil {
			writeError(w, http.StatusBadRequest, resolveErr.Error())
			return
		}
		hostPath = resolvedPath
	}

	previousConfig, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取当前终端配置失败")
		return
	}
	if err := config.Update(s.cfg, func(updated *config.Config) error {
		updated.Terminal.AISkillsEnabled = req.Enabled
		updated.Terminal.AISkillsHostPath = hostPath
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "保存 AI Skill 映射设置失败")
		return
	}
	if err := s.regenerateVMConfig(); err != nil {
		if restoreErr := s.restoreConfigSnapshot(previousConfig); restoreErr != nil {
			log.Printf("[MacNAS Terminal] 回滚 AI Skill 映射配置失败: %v", restoreErr)
		}
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("重新生成虚拟机配置失败: %v", err))
		return
	}

	s.vmMgr.SetConfigDirty(true)
	result, err := s.terminalSkillsState()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取更新后的 AI Skill 映射设置失败")
		return
	}
	result.RequiresRestart = true
	message := "AI Skill 目录映射已关闭"
	if req.Enabled {
		message = "AI Skill 目录已保存为只读映射，请下次启动或重启虚拟机后在终端中生效"
	}
	result.Message = message
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"message":         message,
		"requiresRestart": true,
		"settings":        result,
	})
}

func (s *Server) handleGenerateSSHRootKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Comment string `json:"comment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析失败")
		return
	}

	res, err := s.sshMgr.GenerateRootKey(r.Context(), req.Comment)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "Root ED25519 密钥已生成并成功注入 authorized_keys",
		"result":  res,
	})
}

func (s *Server) handleGetSSHAuthorizedKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.sshMgr.GetRootAuthorizedKeys(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"keys":   keys,
	})
}

func (s *Server) handleAddSSHAuthorizedKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PublicKey string `json:"publicKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.PublicKey) == "" {
		writeError(w, http.StatusBadRequest, "公钥内容不能为空")
		return
	}

	if err := s.sshMgr.AddRootAuthorizedKey(r.Context(), req.PublicKey); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "公钥已成功添加到 Root 授权列表",
	})
}

func (s *Server) handleClearSSHAuthorizedKeys(w http.ResponseWriter, r *http.Request) {
	if err := s.sshMgr.ClearRootAuthorizedKeys(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "Root 已授权公钥已全部清空",
	})
}
