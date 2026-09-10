package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
	"github.com/luluen/mac-nas/pkg/apps"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/docker"
	"github.com/luluen/mac-nas/pkg/samba"
	"github.com/luluen/mac-nas/pkg/storage"
	"github.com/luluen/mac-nas/pkg/system"
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
	projectRoot  string
	mux          *http.ServeMux
}

func NewServer(cfg *config.Config, projectRoot string) *Server {
	vmMgr := vm.NewManager(cfg)
	dockerClient := docker.NewClient(vmMgr)
	appMgr := apps.NewManager(vmMgr, dockerClient, projectRoot)
	sambaMgr := samba.NewManager(cfg, vmMgr)

	s := &Server{
		cfg:          cfg,
		vmMgr:        vmMgr,
		dockerClient: dockerClient,
		appMgr:       appMgr,
		sambaMgr:     sambaMgr,
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

	// 2. VM lifecycle
	s.mux.HandleFunc("POST /api/vm/start", s.handleVMStart)
	s.mux.HandleFunc("POST /api/vm/stop", s.handleVMStop)
	s.mux.HandleFunc("POST /api/vm/restart", s.handleVMRestart)

	// 3. Storage
	s.mux.HandleFunc("GET /api/storage/disks", s.handleStorageDisks)
	s.mux.HandleFunc("POST /api/storage/select", s.handleStorageSelect)

	// 4. Docker
	s.mux.HandleFunc("GET /api/docker/containers", s.handleDockerContainers)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/start", s.handleDockerStart)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/stop", s.handleDockerStop)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/restart", s.handleDockerRestart)
	s.mux.HandleFunc("GET /api/docker/containers/{id}/logs", s.handleDockerLogs)

	// 5. Apps
	s.mux.HandleFunc("GET /api/apps", s.handleAppsList)
	s.mux.HandleFunc("POST /api/apps/{id}/install", s.handleAppInstall)
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
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// System Status Overview
func (s *Server) handleSystemStatus(w http.ResponseWriter, r *http.Request) {
	sysStats, err := system.GetSystemStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	vmStat, _ := s.vmMgr.GetStatus()

	containers, _ := s.dockerClient.ListContainers(r.Context())
	dockerRunningCount := 0
	for _, c := range containers {
		if c.State == "running" {
			dockerRunningCount++
		}
	}

	// Storage overview
	disks, _ := storage.ListDisks(s.cfg.Storage.SelectedDisk)
	var selectedDisk *storage.DiskInfo
	for _, d := range disks {
		if d.IsSelected {
			diskCopy := d
			selectedDisk = &diskCopy
			break
		}
	}

	resp := map[string]interface{}{
		"system": sysStats,
		"vm":     vmStat,
		"docker": map[string]interface{}{
			"ready":        vmStat.DockerReady,
			"total":        len(containers),
			"runningCount": dockerRunningCount,
		},
		"storage": map[string]interface{}{
			"selectedDisk": selectedDisk,
			"diskCount":    len(disks),
		},
		"timestamp": time.Now(),
	}

	writeJSON(w, http.StatusOK, resp)
}

// VM Handlers
func (s *Server) handleVMStart(w http.ResponseWriter, r *http.Request) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if err := s.vmMgr.Start(ctx, s.projectRoot); err != nil {
			log.Printf("[MacNAS] VM Start error: %v", err)
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "starting", "message": "虚拟机启动中..."})
}

func (s *Server) handleVMStop(w http.ResponseWriter, r *http.Request) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := s.vmMgr.Stop(ctx); err != nil {
			log.Printf("[MacNAS] VM Stop error: %v", err)
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "stopping", "message": "虚拟机停止中..."})
}

func (s *Server) handleVMRestart(w http.ResponseWriter, r *http.Request) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if err := s.vmMgr.Restart(ctx, s.projectRoot); err != nil {
			log.Printf("[MacNAS] VM Restart error: %v", err)
		}
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

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"disks":        disks,
		"managedDisks": managed,
		"selectedDisk": s.cfg.Storage.SelectedDisk,
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
	if err := config.SaveConfig(s.cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":       "success",
		"selectedDisk": body.Identifier,
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
