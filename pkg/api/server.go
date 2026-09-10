package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/luluen/mac-nas/pkg/apps"
	"github.com/luluen/mac-nas/pkg/auth"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/docker"
	"github.com/luluen/mac-nas/pkg/samba"
	"github.com/luluen/mac-nas/pkg/storage"
	"github.com/luluen/mac-nas/pkg/system"
	"github.com/luluen/mac-nas/pkg/terminal"
	"github.com/luluen/mac-nas/pkg/vm"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local NAS management
	},
}

type Server struct {
	cfg             *config.Config
	vmMgr           *vm.Manager
	dockerClient    *docker.Client
	appMgr          *apps.Manager
	sambaMgr        *samba.Manager
	powerMgr        *system.PowerManager
	serviceMgr      *system.ServiceManager
	userMgr         *system.UserManager
	sshMgr          *system.SSHManager
	termSettingsMgr *system.TerminalSettingsManager
	authMgr         *auth.Manager
	projectRoot     string
	mux             *http.ServeMux
}

type contextKey string

const userContextKey contextKey = "macnas-user"

func (s *Server) authenticateRequest(r *http.Request) (*auth.User, error) {
	if s.authMgr == nil {
		return nil, fmt.Errorf("auth manager not initialized")
	}
	authHeader := r.Header.Get("Authorization")
	token := ""
	if strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	} else if qToken := r.URL.Query().Get("token"); qToken != "" {
		token = qToken
	}
	return s.authMgr.ValidateToken(token)
}

func getCurrentUser(r *http.Request) *auth.User {
	if u, ok := r.Context().Value(userContextKey).(*auth.User); ok {
		return u
	}
	return nil
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) *auth.User {
	u := getCurrentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return nil
	}
	if u.Role != "admin" {
		writeError(w, http.StatusForbidden, "需要超级管理员权限")
		return nil
	}
	return u
}

func NewServer(cfg *config.Config, projectRoot string) *Server {
	system.StartCPUMonitor()
	vmMgr := vm.NewManager(cfg)
	dockerClient := docker.NewClient(vmMgr, projectRoot)
	appMgr := apps.NewManager(vmMgr, dockerClient, projectRoot)
	sambaMgr := samba.NewManager(cfg, vmMgr)
	powerMgr := system.GetPowerManager(cfg)
	serviceMgr := system.NewServiceManager(cfg, projectRoot)
	userMgr := system.NewUserManager(vmMgr)
	sshMgr := system.NewSSHManager(vmMgr)
	cfgDir, _ := config.ConfigDir()
	termSettingsMgr := system.NewTerminalSettingsManager(cfgDir)

	authMgr, err := auth.NewManager(cfgDir)
	if err != nil {
		log.Printf("[Auth] Warning: failed to init auth manager: %v", err)
	}

	s := &Server{
		cfg:             cfg,
		vmMgr:           vmMgr,
		dockerClient:    dockerClient,
		appMgr:          appMgr,
		sambaMgr:        sambaMgr,
		powerMgr:        powerMgr,
		serviceMgr:      serviceMgr,
		userMgr:         userMgr,
		sshMgr:          sshMgr,
		termSettingsMgr: termSettingsMgr,
		authMgr:         authMgr,
		projectRoot:     projectRoot,
		mux:             http.NewServeMux(),
	}

	s.registerRoutes()
	return s
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Enable CORS
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		// API Authentication Interceptor
		if strings.HasPrefix(r.URL.Path, "/api/") {
			// Whitelisted unauthenticated endpoints
			if r.URL.Path == "/api/auth/login" {
				s.mux.ServeHTTP(w, r)
				return
			}

			user, err := s.authenticateRequest(r)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "未登录或登录已过期，请重新登录",
					"code":  "UNAUTHORIZED",
				})
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, user)
			s.mux.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) registerRoutes() {
	// 1. System
	s.mux.HandleFunc("GET /api/system/status", s.handleSystemStatus)
	s.mux.HandleFunc("GET /api/system/power", s.handleSystemPower)
	s.mux.HandleFunc("POST /api/system/power/toggle", s.handleSystemPowerToggle)
	s.mux.HandleFunc("GET /api/system/service", s.handleSystemServiceStatus)
	s.mux.HandleFunc("POST /api/system/service/install", s.handleSystemServiceInstall)
	s.mux.HandleFunc("POST /api/system/service/uninstall", s.handleSystemServiceUninstall)

	// 2. VM lifecycle & Specs
	s.mux.HandleFunc("POST /api/vm/start", s.handleVMStart)
	s.mux.HandleFunc("POST /api/vm/stop", s.handleVMStop)
	s.mux.HandleFunc("POST /api/vm/restart", s.handleVMRestart)
	s.mux.HandleFunc("GET /api/vm/config", s.handleVMConfigGet)
	s.mux.HandleFunc("POST /api/vm/config", s.handleVMConfigUpdate)

	// 3. Storage
	s.mux.HandleFunc("GET /api/storage/disks", s.handleStorageDisks)
	s.mux.HandleFunc("POST /api/storage/select", s.handleStorageSelect)
	s.mux.HandleFunc("POST /api/storage/bind", s.handleStorageBind)
	s.mux.HandleFunc("POST /api/storage/unbind", s.handleStorageUnbind)
	s.mux.HandleFunc("POST /api/storage/bind-secondary", s.handleStorageBindSecondary)
	s.mux.HandleFunc("POST /api/storage/unbind-secondary", s.handleStorageUnbindSecondary)
	s.mux.HandleFunc("GET /api/storage/mounts", s.handleStorageMountsList)
	s.mux.HandleFunc("POST /api/storage/mounts", s.handleStorageMountsAdd)
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/toggle", s.handleStorageMountsToggle)
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/writable", s.handleStorageMountsWritable)
	s.mux.HandleFunc("DELETE /api/storage/mounts/{id}", s.handleStorageMountsDelete)

	// 4. Docker Overview & Containers
	s.mux.HandleFunc("GET /api/docker/overview", s.handleDockerOverview)
	s.mux.HandleFunc("GET /api/docker/containers", s.handleDockerContainers)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/action", s.handleDockerContainerAction)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/start", s.handleDockerStart)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/stop", s.handleDockerStop)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/restart", s.handleDockerRestart)
	s.mux.HandleFunc("DELETE /api/docker/containers/{id}", s.handleDockerRemoveContainer)
	s.mux.HandleFunc("GET /api/docker/containers/{id}/logs", s.handleDockerLogs)

	// Docker Images
	s.mux.HandleFunc("GET /api/docker/images", s.handleDockerImages)
	s.mux.HandleFunc("POST /api/docker/images/pull", s.handleDockerPullImage)
	s.mux.HandleFunc("POST /api/docker/images/pull/stream", s.handleDockerPullImageStream)
	s.mux.HandleFunc("DELETE /api/docker/images/{id}", s.handleDockerRemoveImage)
	s.mux.HandleFunc("POST /api/docker/images/prune", s.handleDockerPruneImages)

	// Docker Compose
	s.mux.HandleFunc("GET /api/docker/compose", s.handleDockerComposeList)
	s.mux.HandleFunc("GET /api/docker/compose/{name}", s.handleDockerComposeGetYaml)
	s.mux.HandleFunc("POST /api/docker/compose/deploy", s.handleDockerComposeDeploy)
	s.mux.HandleFunc("POST /api/docker/compose/deploy/stream", s.handleDockerComposeDeployStream)
	s.mux.HandleFunc("POST /api/docker/compose/{name}/action", s.handleDockerComposeAction)
	s.mux.HandleFunc("DELETE /api/docker/compose/{name}", s.handleDockerComposeDelete)

	// Docker Networks & Mirrors
	s.mux.HandleFunc("GET /api/docker/networks", s.handleDockerNetworks)
	s.mux.HandleFunc("GET /api/docker/mirrors", s.handleDockerGetMirrors)
	s.mux.HandleFunc("POST /api/docker/mirrors", s.handleDockerSetMirrors)

	// 5. Apps
	s.mux.HandleFunc("GET /api/apps", s.handleAppsList)
	s.mux.HandleFunc("GET /api/apps/{id}/config", s.handleAppGetConfig)
	s.mux.HandleFunc("POST /api/apps/{id}/install", s.handleAppInstall)
	s.mux.HandleFunc("GET /api/apps/{id}/install/stream", s.handleAppInstallStream)
	s.mux.HandleFunc("POST /api/apps/{id}/install/custom", s.handleAppInstallCustomStream)
	s.mux.HandleFunc("POST /api/apps/custom", s.handleAppCustomAdd)
	s.mux.HandleFunc("DELETE /api/apps/custom/{id}", s.handleAppCustomDelete)
	s.mux.HandleFunc("POST /api/apps/sync", s.handleAppStoreSync)
	s.mux.HandleFunc("POST /api/apps/{id}/start", s.handleAppStart)
	s.mux.HandleFunc("POST /api/apps/{id}/stop", s.handleAppStop)
	s.mux.HandleFunc("POST /api/apps/{id}/restart", s.handleAppRestart)
	s.mux.HandleFunc("POST /api/apps/{id}/uninstall", s.handleAppUninstall)
	s.mux.HandleFunc("GET /api/apps/{id}/logs", s.handleAppLogs)

	// 6. Samba
	s.mux.HandleFunc("GET /api/samba/status", s.handleSambaStatus)
	s.mux.HandleFunc("POST /api/samba/shares", s.handleSambaShareAddOrUpdate)
	s.mux.HandleFunc("PUT /api/samba/shares/{id}", s.handleSambaShareAddOrUpdate)
	s.mux.HandleFunc("POST /api/samba/shares/{id}/toggle", s.handleSambaShareToggle)
	s.mux.HandleFunc("DELETE /api/samba/shares/{id}", s.handleSambaShareDelete)
	s.mux.HandleFunc("POST /api/samba/service/toggle", s.handleSambaServiceToggle)
	s.mux.HandleFunc("POST /api/samba/service/restart", s.handleSambaServiceRestart)
	s.mux.HandleFunc("POST /api/samba/password", s.handleSambaPassword)

	// 7. WebSocket logs
	s.mux.HandleFunc("GET /api/ws/logs", s.handleWSLogs)

	// 8. Web Terminal & File System
	s.mux.HandleFunc("GET /api/terminal/ws", s.handleTerminalWS)
	s.mux.HandleFunc("GET /api/terminal/files", s.handleTerminalFilesList)
	s.mux.HandleFunc("GET /api/terminal/files/read", s.handleTerminalFileRead)
	s.mux.HandleFunc("POST /api/terminal/files/write", s.handleTerminalFileWrite)
	s.mux.HandleFunc("POST /api/terminal/files/mkdir", s.handleTerminalFileMkdir)
	s.mux.HandleFunc("POST /api/terminal/files/upload", s.handleTerminalFileUpload)
	s.mux.HandleFunc("POST /api/terminal/files/rename", s.handleTerminalFileRename)
	s.mux.HandleFunc("DELETE /api/terminal/files", s.handleTerminalFileDelete)
	s.mux.HandleFunc("GET /api/terminal/files/download", s.handleTerminalFileDownload)
	s.mux.HandleFunc("GET /api/terminal/files/raw", s.handleTerminalFileRaw)
	s.mux.HandleFunc("POST /api/terminal/files/copy", s.handleTerminalFilesCopy)
	s.mux.HandleFunc("POST /api/terminal/files/move", s.handleTerminalFilesMove)
	s.mux.HandleFunc("POST /api/terminal/files/trash", s.handleTerminalFilesTrash)
	s.mux.HandleFunc("GET /api/terminal/files/trash", s.handleTerminalFilesTrashList)
	s.mux.HandleFunc("POST /api/terminal/files/restore", s.handleTerminalFilesRestore)
	s.mux.HandleFunc("POST /api/terminal/files/trash/delete", s.handleTerminalFilesTrashDelete)
	s.mux.HandleFunc("POST /api/terminal/files/empty-trash", s.handleTerminalFilesEmptyTrash)

	// 9. System Security, Users & SSH
	s.mux.HandleFunc("GET /api/system/users", s.handleListUsers)
	s.mux.HandleFunc("POST /api/system/users", s.handleCreateUser)
	s.mux.HandleFunc("POST /api/system/users/{username}/password", s.handleUpdateUserPassword)
	s.mux.HandleFunc("DELETE /api/system/users/{username}", s.handleDeleteUser)
	s.mux.HandleFunc("POST /api/system/root/password", s.handleUpdateRootPassword)
	s.mux.HandleFunc("GET /api/system/ssh", s.handleGetSSHConfig)
	s.mux.HandleFunc("POST /api/system/ssh", s.handleUpdateSSHConfig)
	s.mux.HandleFunc("POST /api/system/ssh/toggle", s.handleToggleSSH)
	s.mux.HandleFunc("POST /api/system/ssh/keys/generate", s.handleGenerateSSHRootKey)
	s.mux.HandleFunc("GET /api/system/ssh/keys", s.handleGetSSHAuthorizedKeys)
	s.mux.HandleFunc("POST /api/system/ssh/keys/add", s.handleAddSSHAuthorizedKey)
	s.mux.HandleFunc("DELETE /api/system/ssh/keys", s.handleClearSSHAuthorizedKeys)
	s.mux.HandleFunc("GET /api/system/terminal/settings", s.handleGetTerminalSettings)
	s.mux.HandleFunc("POST /api/system/terminal/settings", s.handleUpdateTerminalSettings)

	// 10. Web Console Authentication & User Management
	s.mux.HandleFunc("POST /api/auth/login", s.handleAuthLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleAuthLogout)
	s.mux.HandleFunc("GET /api/auth/me", s.handleAuthMe)
	s.mux.HandleFunc("POST /api/auth/change-pwd", s.handleAuthChangePassword)
	s.mux.HandleFunc("GET /api/auth/users", s.handleAuthListUsers)
	s.mux.HandleFunc("POST /api/auth/users", s.handleAuthCreateUser)
	s.mux.HandleFunc("PUT /api/auth/users/{id}", s.handleAuthUpdateUser)
	s.mux.HandleFunc("DELETE /api/auth/users/{id}", s.handleAuthDeleteUser)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// System Status Overview (Parallelized for low latency)
func (s *Server) handleSystemStatus(w http.ResponseWriter, r *http.Request) {
	var (
		sysStats           *system.SystemStats
		sysErr             error
		vmStat             *vm.VMStatus
		containers         []docker.ContainerInfo
		dockerRunningCount int
		selectedDisk       *storage.DiskInfo
		disks              []storage.DiskInfo
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
		vmStat, _ = s.vmMgr.GetStatus()
	}()

	// 3. Docker containers
	go func() {
		defer wg.Done()
		containers, _ = s.dockerClient.ListContainers(r.Context())
		for _, c := range containers {
			if c.State == "running" {
				dockerRunningCount++
			}
		}
	}()

	// 4. Storage overview
	go func() {
		defer wg.Done()
		disks, _ = storage.ListDisks(s.cfg.Storage.SelectedDisk)
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

	resp := map[string]interface{}{
		"system":      sysStats,
		"power":       s.powerMgr.GetStatus(),
		"service":     s.serviceMgr.GetStatus(),
		"vm":          vmStat,
		"vmAction":    s.vmMgr.GetVMAction(),
		"configDirty": s.vmMgr.IsConfigDirty(),
		"docker": map[string]interface{}{
			"ready":        vmStat.DockerReady,
			"total":        len(containers),
			"runningCount": dockerRunningCount,
		},
		"storage": map[string]interface{}{
			"selectedDisk":     selectedDisk,
			"diskCount":        len(disks),
			"isExternalActive": s.cfg.Storage.DataPath != "",
			"dataPath":         s.cfg.Storage.DataPath,
			"mountPoint":       s.cfg.Storage.MountPoint,
		},
		"timestamp": time.Now(),
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
	port := s.cfg.Port
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

// VM Handlers
func (s *Server) handleVMStart(w http.ResponseWriter, r *http.Request) {
	s.vmMgr.SetVMAction("starting")
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if err := s.vmMgr.Start(ctx, s.projectRoot); err != nil {
			log.Printf("[MacNAS] VM Start error: %v", err)
		} else {
			s.vmMgr.SetConfigDirty(false)
			_ = s.sambaMgr.EnsurePassword(ctx)
		}
		s.vmMgr.SetVMAction("")
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "starting", "message": "虚拟机启动中..."})
}

func (s *Server) handleVMStop(w http.ResponseWriter, r *http.Request) {
	s.vmMgr.SetVMAction("stopping")
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := s.vmMgr.Stop(ctx); err != nil {
			log.Printf("[MacNAS] VM Stop error: %v", err)
		}
		s.vmMgr.SetVMAction("")
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "stopping", "message": "虚拟机停止中..."})
}

func (s *Server) handleVMRestart(w http.ResponseWriter, r *http.Request) {
	s.vmMgr.SetVMAction("restarting")
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if err := s.vmMgr.Restart(ctx, s.projectRoot); err != nil {
			log.Printf("[MacNAS] VM Restart error: %v", err)
		} else {
			s.vmMgr.SetConfigDirty(false)
			_ = s.sambaMgr.EnsurePassword(ctx)
		}
		s.vmMgr.SetVMAction("")
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting", "message": "虚拟机重启中..."})
}

// Storage Handlers
func (s *Server) handleStorageDisks(w http.ResponseWriter, r *http.Request) {
	disks, err := storage.ListDisks(s.cfg.Storage.SelectedDisk, s.cfg.Storage.SecondaryDisk)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	managed, _ := storage.ListManagedDisks()

	isExternal := (s.cfg.Storage.DataPath != "")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"disks":            disks,
		"managedDisks":     managed,
		"selectedDisk":     s.cfg.Storage.SelectedDisk,
		"secondaryDisk":    s.cfg.Storage.SecondaryDisk,
		"secondaryMount":   s.cfg.Storage.SecondaryMount,
		"isExternalActive": isExternal,
		"dataPath":         s.cfg.Storage.DataPath,
		"mountPoint":       s.cfg.Storage.MountPoint,
	})
}

func (s *Server) handleStorageSelect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Identifier string `json:"identifier"` // e.g. "disk4" or "/dev/disk4"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	s.cfg.Storage.SelectedDisk = body.Identifier
	storage.InvalidateDisksCache()
	if err := config.SaveConfig(s.cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":       "success",
		"selectedDisk": body.Identifier,
	})
}

func (s *Server) handleStorageBind(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Identifier string `json:"identifier"`
		MountPoint string `json:"mountPoint"`
		SizeGB     int    `json:"sizeGB"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	imgPath, err := storage.BindExternalDisk(s.cfg, req.Identifier, req.MountPoint, req.SizeGB)
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

	res, err := storage.BindSecondaryDisk(s.cfg, req.DiskID, req.MountPoint, req.TargetDir, req.GuestTarget, s.projectRoot, s.cfg.VM.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Also regenerate lima config
	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	home, _ := os.UserHomeDir()
	outputPath := filepath.Join(home, ".macnas", "macnas.yaml")
	_ = s.vmMgr.GenerateConfigFile(tmplPath, outputPath)
	s.vmMgr.SetConfigDirty(true)
	go s.vmMgr.SyncMounts(context.Background())

	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleStorageUnbindSecondary(w http.ResponseWriter, r *http.Request) {
	err := storage.UnbindSecondaryDisk(s.cfg, s.projectRoot, s.cfg.VM.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	home, _ := os.UserHomeDir()
	outputPath := filepath.Join(home, ".macnas", "macnas.yaml")
	_ = s.vmMgr.GenerateConfigFile(tmplPath, outputPath)
	s.vmMgr.SetConfigDirty(true)
	go s.vmMgr.SyncMounts(context.Background())

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
	var mount config.LocalMount
	if err := json.NewDecoder(r.Body).Decode(&mount); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := storage.AddOrUpdateLocalMount(s.cfg, mount); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	cfgDir, _ := config.ConfigDir()
	renderedYAML := filepath.Join(cfgDir, "macnas.yaml")
	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	_ = s.vmMgr.GenerateConfigFile(tmplPath, renderedYAML)

	s.vmMgr.SetConfigDirty(true)
	go s.vmMgr.SyncMounts(context.Background())
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
	id := r.PathValue("id")
	enabled, err := storage.ToggleLocalMount(s.cfg, id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	cfgDir, _ := config.ConfigDir()
	renderedYAML := filepath.Join(cfgDir, "macnas.yaml")
	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	_ = s.vmMgr.GenerateConfigFile(tmplPath, renderedYAML)

	s.vmMgr.SetConfigDirty(true)
	go s.vmMgr.SyncMounts(context.Background())
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
	id := r.PathValue("id")
	if err := storage.DeleteLocalMount(s.cfg, id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	cfgDir, _ := config.ConfigDir()
	renderedYAML := filepath.Join(cfgDir, "macnas.yaml")
	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	_ = s.vmMgr.GenerateConfigFile(tmplPath, renderedYAML)

	s.vmMgr.SetConfigDirty(true)
	go s.vmMgr.SyncMounts(context.Background())
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
	id := r.PathValue("id")
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
	for _, m := range s.cfg.Storage.LocalMounts {
		if m.ID == id {
			target = m.GuestTarget
			break
		}
	}
	remountCmd := fmt.Sprintf("sudo mount -o remount,%s /mnt/macnas-mounts/%s 2>/dev/null || true; sudo mount -o remount,%s /data/%s 2>/dev/null || true", mode, id, mode, target)
	_, _ = s.vmMgr.Exec(r.Context(), "bash", "-c", remountCmd)

	cfgDir, _ := config.ConfigDir()
	renderedYAML := filepath.Join(cfgDir, "macnas.yaml")
	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	_ = s.vmMgr.GenerateConfigFile(tmplPath, renderedYAML)

	s.vmMgr.SetConfigDirty(true)
	go s.vmMgr.SyncMounts(context.Background())

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

// Docker Handlers
func (s *Server) handleDockerOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.dockerClient.GetOverview(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (s *Server) handleDockerContainers(w http.ResponseWriter, r *http.Request) {
	containers, err := s.dockerClient.ListContainers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.ContainerInfo{})
		return
	}
	writeJSON(w, http.StatusOK, containers)
}

func (s *Server) handleDockerContainerAction(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Action string `json:"action"` // start, stop, restart, remove
		Force  bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	var err error
	switch req.Action {
	case "start":
		err = s.dockerClient.StartContainer(r.Context(), id)
	case "stop":
		err = s.dockerClient.StopContainer(r.Context(), id)
	case "restart":
		err = s.dockerClient.RestartContainer(r.Context(), id)
	case "remove":
		err = s.dockerClient.RemoveContainer(r.Context(), id, req.Force)
	default:
		writeError(w, http.StatusBadRequest, "Unsupported container action")
		return
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerRemoveContainer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if err := s.dockerClient.RemoveContainer(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerStart(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.dockerClient.StartContainer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerStop(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.dockerClient.StopContainer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerRestart(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.dockerClient.RestartContainer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerLogs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tailStr := r.URL.Query().Get("tail")
	tail := 100
	if n, err := strconv.Atoi(tailStr); err == nil && n > 0 {
		tail = n
	}
	logs, err := s.dockerClient.GetLogs(r.Context(), id, tail)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": logs})
}

// Docker Images Handlers
func (s *Server) handleDockerImages(w http.ResponseWriter, r *http.Request) {
	images, err := s.dockerClient.ListImages(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.ImageInfo{})
		return
	}
	writeJSON(w, http.StatusOK, images)
}

func (s *Server) handleDockerPullImage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Image string `json:"image"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Image) == "" {
		writeError(w, http.StatusBadRequest, "镜像名称不能为空")
		return
	}

	var buf bytes.Buffer
	if err := s.dockerClient.PullImage(r.Context(), req.Image, &buf); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"logs":   buf.String(),
	})
}

func (s *Server) handleDockerPullImageStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	var req struct {
		Image string `json:"image"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Image) == "" {
		http.Error(w, "镜像名称不能为空", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}
	err := s.dockerClient.PullImage(r.Context(), req.Image, sw)
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
	} else {
		fmt.Fprintf(w, "event: done\ndata: {\"status\":\"success\",\"image\":\"%s\"}\n\n", req.Image)
	}
	flusher.Flush()
}

func (s *Server) handleDockerRemoveImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if err := s.dockerClient.RemoveImage(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerPruneImages(w http.ResponseWriter, r *http.Request) {
	out, err := s.dockerClient.PruneImages(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "success",
		"output": out,
	})
}

// Docker Compose Handlers
func (s *Server) handleDockerComposeList(w http.ResponseWriter, r *http.Request) {
	projects, err := s.dockerClient.ListComposeProjects(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.ComposeProject{})
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleDockerComposeGetYaml(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	yamlContent, err := s.dockerClient.GetComposeYaml(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"name": name,
		"yaml": yamlContent,
	})
}

func (s *Server) handleDockerComposeDeploy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		YAML string `json:"yaml"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var buf bytes.Buffer
	if err := s.dockerClient.DeployCompose(r.Context(), req.Name, req.YAML, &buf); err != nil {
		detail := buf.String()
		if detail != "" {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("%v\n%s", err, detail))
		} else {
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"logs":   buf.String(),
	})
}

func (s *Server) handleDockerComposeDeployStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	var req struct {
		Name string `json:"name"`
		YAML string `json:"yaml"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}
	err := s.dockerClient.DeployCompose(r.Context(), req.Name, req.YAML, sw)
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
	} else {
		fmt.Fprintf(w, "event: done\ndata: {\"status\":\"success\",\"name\":\"%s\"}\n\n", req.Name)
	}
	flusher.Flush()
}

func (s *Server) handleDockerComposeAction(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req struct {
		Action string `json:"action"` // start, stop, restart, down, pull
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var buf bytes.Buffer
	if err := s.dockerClient.ComposeAction(r.Context(), name, req.Action, &buf); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "success",
		"output": buf.String(),
	})
}

func (s *Server) handleDockerComposeDelete(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	deleteVolumes := r.URL.Query().Get("volumes") == "true"
	if err := s.dockerClient.DeleteComposeProject(r.Context(), name, deleteVolumes); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

// Docker Networks & Mirrors Handlers
func (s *Server) handleDockerNetworks(w http.ResponseWriter, r *http.Request) {
	networks, err := s.dockerClient.ListNetworks(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.DockerNetwork{})
		return
	}
	writeJSON(w, http.StatusOK, networks)
}

func (s *Server) handleDockerGetMirrors(w http.ResponseWriter, r *http.Request) {
	mirrors, err := s.dockerClient.GetRegistryMirrors(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"mirrors": mirrors})
}

func (s *Server) handleDockerSetMirrors(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mirrors []string `json:"mirrors"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := s.dockerClient.SetRegistryMirrors(r.Context(), req.Mirrors); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

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
	id := r.PathValue("id")
	if err := s.appMgr.Install(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "应用安装成功"})
}

type appSSEWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func (sw *appSSEWriter) Write(p []byte) (n int, err error) {
	lines := strings.Split(string(p), "\n")
	for _, line := range lines {
		trimmed := strings.TrimRight(line, "\r")
		if trimmed != "" {
			fmt.Fprintf(sw.w, "data: %s\n\n", trimmed)
		}
	}
	sw.flusher.Flush()
	return len(p), nil
}

func (s *Server) handleAppInstallStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	id := r.PathValue("id")
	portStr := r.URL.Query().Get("port")
	port := 0
	if portStr != "" {
		fmt.Sscanf(portStr, "%d", &port)
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}

	ctx := r.Context()
	err := s.appMgr.InstallStream(ctx, id, port, sw)
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
	} else {
		fmt.Fprintf(w, "event: done\ndata: {\"status\":\"success\",\"id\":\"%s\"}\n\n", id)
	}
	flusher.Flush()
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

	id := r.PathValue("id")

	var cfg apps.InstallCustomConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}

	ctx := r.Context()
	err := s.appMgr.InstallStreamCustom(ctx, id, cfg, sw)
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
	} else {
		fmt.Fprintf(w, "event: done\ndata: {\"status\":\"success\",\"id\":\"%s\"}\n\n", id)
	}
	flusher.Flush()
}

func (s *Server) handleAppCustomAdd(w http.ResponseWriter, r *http.Request) {
	var req apps.CustomAppInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	meta, err := s.appMgr.AddCustomApp(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

func (s *Server) handleAppCustomDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.appMgr.DeleteCustomApp(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppStoreSync(w http.ResponseWriter, r *http.Request) {
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
	id := r.PathValue("id")
	if err := s.appMgr.Start(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppStop(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.appMgr.Stop(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppRestart(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.appMgr.Restart(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppUninstall(w http.ResponseWriter, r *http.Request) {
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
	tail := 100
	if n, err := strconv.Atoi(tailStr); err == nil && n > 0 {
		tail = n
	}
	logs, err := s.appMgr.GetLogs(r.Context(), id, tail)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": logs})
}

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

// WebSocket Logs Stream
func (s *Server) handleWSLogs(w http.ResponseWriter, r *http.Request) {
	appOrContainer := r.URL.Query().Get("target") // e.g. "jellyfin" or container ID
	isApp := r.URL.Query().Get("type") == "app"

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			var logs string
			var err error
			if isApp {
				logs, err = s.appMgr.GetLogs(r.Context(), appOrContainer, 50)
			} else {
				logs, err = s.dockerClient.GetLogs(r.Context(), appOrContainer, 50)
			}

			if err == nil {
				msg := map[string]interface{}{
					"timestamp": time.Now().Format("15:04:05"),
					"logs":      logs,
				}
				if err := conn.WriteJSON(msg); err != nil {
					return
				}
			}
		}
	}
}

// VM Hardware Specs Configuration Handlers
func (s *Server) handleVMConfigGet(w http.ResponseWriter, r *http.Request) {
	totalMemGB := 16
	if vMem, err := mem.VirtualMemory(); err == nil && vMem.Total > 0 {
		totalMemGB = int(vMem.Total / 1024 / 1024 / 1024)
	}

	vmStat, _ := s.vmMgr.GetStatus()

	resp := map[string]interface{}{
		"cpus":               s.cfg.VM.CPUs,
		"memory":             s.cfg.VM.Memory,
		"diskSize":           s.cfg.VM.DiskSize,
		"hostCpus":           runtime.NumCPU(),
		"hostMemoryGB":       totalMemGB,
		"vmStatus":           vmStat.Status,
		"isDynamicMemory":    true,
		"balloonDescription": "基于 Apple Virtualization.framework (vz) 原生 Virtio-Balloon 气球驱动。配置的内存为 VM 最大使用配额，系统按需动态分水，闲置内存由 macOS 自动回收。",
		"diskDescription":    "系统根盘用于存储 Ubuntu 核心系统与 Docker 运行层。支持安全在线/重启扩容（只增不减以保障分区文件完整性）。",
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleVMConfigUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CPUs     int `json:"cpus"`
		Memory   int `json:"memory"`
		DiskSize int `json:"diskSize"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数解析失败")
		return
	}

	if req.CPUs < 1 || req.CPUs > runtime.NumCPU() {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("CPU 核心数必须在 1 到 %d 之间", runtime.NumCPU()))
		return
	}

	if req.Memory < 2 || req.Memory > 64 {
		writeError(w, http.StatusBadRequest, "内存分配必须在 2 GiB 到 64 GiB 之间")
		return
	}

	if req.DiskSize < s.cfg.VM.DiskSize {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("系统盘容量只支持扩容（当前为 %d GiB，不能缩减）", s.cfg.VM.DiskSize))
		return
	}

	if err := s.vmMgr.UpdateSpecs(req.CPUs, req.Memory, req.DiskSize, s.projectRoot); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"requiresRestart": true,
		"message":         "虚拟机硬件规格已更新！请重启虚拟机以加载新配置生效。",
		"cpus":            s.cfg.VM.CPUs,
		"memory":          s.cfg.VM.Memory,
		"diskSize":        s.cfg.VM.DiskSize,
	})
}

// Web Terminal Handlers
func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("user") == "" {
		defUser := s.termSettingsMgr.Get().DefaultLoginUser
		if defUser == "root" {
			q := r.URL.Query()
			q.Set("user", "root")
			r.URL.RawQuery = q.Encode()
		}
	}
	terminal.HandleTerminalWS(w, r, s.cfg.VM.Name)
}

// File System Handlers
func (s *Server) handleTerminalFilesList(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		targetPath = "/data"
	}

	items, err := terminal.ListFiles(s.cfg.VM.Name, targetPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"path":   targetPath,
		"items":  items,
	})
}

func (s *Server) handleTerminalFileRead(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeError(w, http.StatusBadRequest, "缺少文件路径")
		return
	}

	content, err := terminal.ReadFile(s.cfg.VM.Name, filePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"path":    filePath,
		"content": content,
	})
}

func (s *Server) handleTerminalFileWrite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}

	if req.Path == "" {
		writeError(w, http.StatusBadRequest, "文件路径不能为空")
		return
	}

	if err := terminal.WriteFile(s.cfg.VM.Name, req.Path, req.Content); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "文件保存成功"})
}

func (s *Server) handleTerminalFileMkdir(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}

	if req.Path == "" {
		writeError(w, http.StatusBadRequest, "文件夹路径不能为空")
		return
	}

	if err := terminal.CreateDir(s.cfg.VM.Name, req.Path); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "文件夹创建成功"})
}

func (s *Server) handleTerminalFileUpload(w http.ResponseWriter, r *http.Request) {
	targetDir := r.FormValue("targetDir")
	if targetDir == "" {
		targetDir = "/data"
	}

	if err := terminal.UploadFile(w, r, s.cfg.VM.Name, targetDir); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "文件上传成功"})
}

func (s *Server) handleTerminalFileDelete(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		writeError(w, http.StatusBadRequest, "缺少路径参数")
		return
	}

	if err := terminal.DeletePath(s.cfg.VM.Name, targetPath); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "删除成功"})
}

func (s *Server) handleTerminalFileDownload(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		writeError(w, http.StatusBadRequest, "缺少路径参数")
		return
	}

	terminal.DownloadFile(w, r, s.cfg.VM.Name, targetPath)
}

func (s *Server) handleTerminalFileRename(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}

	if req.OldPath == "" || req.NewPath == "" {
		writeError(w, http.StatusBadRequest, "原路径和新路径均不能为空")
		return
	}

	if err := terminal.RenamePath(s.cfg.VM.Name, req.OldPath, req.NewPath); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "重命名成功"})
}

func (s *Server) handleTerminalFileRaw(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		writeError(w, http.StatusBadRequest, "缺少路径参数")
		return
	}

	terminal.StreamMediaFile(w, r, s.cfg.VM.Name, targetPath)
}

func (s *Server) handleTerminalFilesCopy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SrcPaths []string `json:"srcPaths"`
		DestDir  string   `json:"destDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.SrcPaths) == 0 || req.DestDir == "" {
		writeError(w, http.StatusBadRequest, "源文件与目标目录均不能为空")
		return
	}

	if err := terminal.CopyPaths(s.cfg.VM.Name, req.SrcPaths, req.DestDir); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已成功复制 %d 个项目到目标目录", len(req.SrcPaths)),
	})
}

func (s *Server) handleTerminalFilesMove(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SrcPaths []string `json:"srcPaths"`
		DestDir  string   `json:"destDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.SrcPaths) == 0 || req.DestDir == "" {
		writeError(w, http.StatusBadRequest, "源文件与目标目录均不能为空")
		return
	}

	if err := terminal.MovePaths(s.cfg.VM.Name, req.SrcPaths, req.DestDir); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已成功移动 %d 个项目到目标目录", len(req.SrcPaths)),
	})
}

func (s *Server) handleTerminalFilesTrash(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "未选择要移入回收站的项目")
		return
	}

	if err := terminal.MoveToTrash(s.cfg.VM.Name, req.Paths); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已将 %d 个项目移入回收站", len(req.Paths)),
	})
}

func (s *Server) handleTerminalFilesTrashList(w http.ResponseWriter, r *http.Request) {
	items, err := terminal.ListTrash(s.cfg.VM.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"items":  items,
	})
}

func (s *Server) handleTerminalFilesRestore(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "未选择要还原的项目")
		return
	}

	if err := terminal.RestoreTrash(s.cfg.VM.Name, req.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已成功还原 %d 个项目", len(req.IDs)),
	})
}

func (s *Server) handleTerminalFilesTrashDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "未选择要删除的项目")
		return
	}

	count, err := terminal.DeleteTrashItems(s.cfg.VM.Name, req.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": fmt.Sprintf("已成功将 %d 个项目移入 Mac 本机废纸篓 (~/.Trash)", count),
		"count":   count,
	})
}

func (s *Server) handleTerminalFilesEmptyTrash(w http.ResponseWriter, r *http.Request) {
	count, err := terminal.EmptyTrash(s.cfg.VM.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": fmt.Sprintf("回收站已清空，所有 %d 个项目已安全移入 Mac 本机废纸篓 (~/.Trash)", count),
		"count":   count,
	})
}

// -------------------------------------------------------------
// System Security & Settings Handlers
// -------------------------------------------------------------

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

func (s *Server) handleGenerateSSHRootKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Comment string `json:"comment"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

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

// -------------------------------------------------------------
// 10. Web Console Auth & User Management Handlers
// -------------------------------------------------------------

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username   string `json:"username"`
		Password   string `json:"password"`
		RememberMe bool   `json:"rememberMe"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数解析错误")
		return
	}

	token, user, err := s.authMgr.Login(req.Username, req.Password, req.RememberMe)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token != "" && s.authMgr != nil {
		s.authMgr.Logout(token)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAuthMe(w http.ResponseWriter, r *http.Request) {
	user := getCurrentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": user,
	})
}

func (s *Server) handleAuthChangePassword(w http.ResponseWriter, r *http.Request) {
	user := getCurrentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}

	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}

	if err := s.authMgr.ChangePassword(user.ID, req.OldPassword, req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "密码修改成功",
	})
}

func (s *Server) handleAuthListUsers(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}

	users := s.authMgr.ListUsers()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"users": users,
	})
}

func (s *Server) handleAuthCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}

	var req auth.CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}

	newUser, err := s.authMgr.CreateUser(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"user":   newUser,
	})
}

func (s *Server) handleAuthUpdateUser(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "用户 ID 不能为空")
		return
	}

	var req auth.UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}

	updatedUser, err := s.authMgr.UpdateUser(id, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"user":   updatedUser,
	})
}

func (s *Server) handleAuthDeleteUser(w http.ResponseWriter, r *http.Request) {
	currentUser := s.requireAdmin(w, r)
	if currentUser == nil {
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "用户 ID 不能为空")
		return
	}

	if err := s.authMgr.DeleteUser(id, currentUser.ID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "用户已成功删除",
	})
}


