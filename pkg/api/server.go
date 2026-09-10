package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/luluen/mac-nas/pkg/apps"
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
	cfg          *config.Config
	vmMgr        *vm.Manager
	dockerClient *docker.Client
	appMgr       *apps.Manager
	sambaMgr     *samba.Manager
	powerMgr     *system.PowerManager
	serviceMgr   *system.ServiceManager
	projectRoot  string
	mux          *http.ServeMux
}

func NewServer(cfg *config.Config, projectRoot string) *Server {
	system.StartCPUMonitor()
	vmMgr := vm.NewManager(cfg)
	dockerClient := docker.NewClient(vmMgr)
	appMgr := apps.NewManager(vmMgr, dockerClient, projectRoot)
	sambaMgr := samba.NewManager(cfg, vmMgr)
	powerMgr := system.GetPowerManager(cfg)
	serviceMgr := system.NewServiceManager(cfg, projectRoot)

	s := &Server{
		cfg:          cfg,
		vmMgr:        vmMgr,
		dockerClient: dockerClient,
		appMgr:       appMgr,
		sambaMgr:     sambaMgr,
		powerMgr:     powerMgr,
		serviceMgr:   serviceMgr,
		projectRoot:  projectRoot,
		mux:          http.NewServeMux(),
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
	s.mux.HandleFunc("GET /api/storage/mounts", s.handleStorageMountsList)
	s.mux.HandleFunc("POST /api/storage/mounts", s.handleStorageMountsAdd)
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/toggle", s.handleStorageMountsToggle)
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/writable", s.handleStorageMountsWritable)
	s.mux.HandleFunc("DELETE /api/storage/mounts/{id}", s.handleStorageMountsDelete)

	// 4. Docker
	s.mux.HandleFunc("GET /api/docker/containers", s.handleDockerContainers)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/start", s.handleDockerStart)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/stop", s.handleDockerStop)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/restart", s.handleDockerRestart)
	s.mux.HandleFunc("GET /api/docker/containers/{id}/logs", s.handleDockerLogs)

	// 5. Apps
	s.mux.HandleFunc("GET /api/apps", s.handleAppsList)
	s.mux.HandleFunc("POST /api/apps/{id}/install", s.handleAppInstall)
	s.mux.HandleFunc("GET /api/apps/{id}/install/stream", s.handleAppInstallStream)
	s.mux.HandleFunc("POST /api/apps/{id}/start", s.handleAppStart)
	s.mux.HandleFunc("POST /api/apps/{id}/stop", s.handleAppStop)
	s.mux.HandleFunc("POST /api/apps/{id}/restart", s.handleAppRestart)
	s.mux.HandleFunc("POST /api/apps/{id}/uninstall", s.handleAppUninstall)
	s.mux.HandleFunc("GET /api/apps/{id}/logs", s.handleAppLogs)

	// 6. Samba
	s.mux.HandleFunc("GET /api/samba/status", s.handleSambaStatus)
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
	s.mux.HandleFunc("POST /api/terminal/files/empty-trash", s.handleTerminalFilesEmptyTrash)
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
	disks, err := storage.ListDisks(s.cfg.Storage.SelectedDisk)
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
func (s *Server) handleDockerContainers(w http.ResponseWriter, r *http.Request) {
	containers, err := s.dockerClient.ListContainers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.ContainerInfo{})
		return
	}
	writeJSON(w, http.StatusOK, containers)
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

func (s *Server) handleTerminalFilesEmptyTrash(w http.ResponseWriter, r *http.Request) {
	if err := terminal.EmptyTrash(s.cfg.VM.Name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "回收站已彻底清空",
	})
}
