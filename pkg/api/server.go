package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/luluen/mac-nas/pkg/apps"
	"github.com/luluen/mac-nas/pkg/auth"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/docker"
	"github.com/luluen/mac-nas/pkg/samba"
	"github.com/luluen/mac-nas/pkg/storage"
	"github.com/luluen/mac-nas/pkg/system"
	"github.com/luluen/mac-nas/pkg/terminal"
	"github.com/luluen/mac-nas/pkg/vm"
	"github.com/shirou/gopsutil/v3/mem"
)

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
	authInitErr     error
	projectRoot     string
	allowedOrigins  map[string]struct{}
	uploadSlots     chan struct{}
	mux             *http.ServeMux
	serverCtx       context.Context
	serverCancel    context.CancelFunc
	closeOnce       sync.Once
	backgroundMu    sync.Mutex
	backgroundWG    sync.WaitGroup
	closing         bool
	mountSyncMu     sync.Mutex
	mountSyncActive bool
	storageOpMu     sync.Mutex
	storageOpActive bool
	dockerOpMu      sync.Mutex
	dockerOpActive  bool
}

type contextKey string

const userContextKey contextKey = "macnas-user"

// JSON requests are control-plane operations. Keep them small so malformed
// or hostile payloads cannot make every handler allocate unbounded memory.
// Multipart file uploads use their own, much larger limit in the upload
// handler and are deliberately not covered by this cap.
const maxJSONBodyBytes = 8 << 20

const sessionCookieName = "macnas_session"

func configuredOrigins(raw string) map[string]struct{} {
	origins := make(map[string]struct{})
	for _, origin := range strings.Split(raw, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}
	return origins
}

func (s *Server) originAllowed(r *http.Request, origin string) bool {
	// Same-origin requests are always allowed. Cross-origin development or
	// reverse-proxy deployments must opt in via MACNAS_ALLOWED_ORIGINS.
	if origin == "http://"+r.Host || origin == "https://"+r.Host {
		return true
	}
	_, ok := s.allowedOrigins[origin]
	return ok
}

func (s *Server) websocketUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return s.originAllowed(r, strings.TrimSpace(r.Header.Get("Origin")))
		},
	}
}

func requestIP(r *http.Request) string {
	host := r.RemoteAddr
	if parsedHost, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = parsedHost
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return "unknown"
}

func isLoopbackRequest(r *http.Request) bool {
	host := r.RemoteAddr
	if parsedHost, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = parsedHost
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) authenticateRequest(r *http.Request) (*auth.User, error) {
	if s.authMgr == nil {
		return nil, fmt.Errorf("auth manager not initialized")
	}
	authHeader := r.Header.Get("Authorization")
	token := ""
	if strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	} else if sessionCookie, err := r.Cookie(sessionCookieName); err == nil {
		token = sessionCookie.Value
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

// adminOnly protects state-changing and privileged operations at the routing
// boundary. Handlers should not rely on the frontend hiding a button as an
// authorization mechanism.
func (s *Server) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.requireAdmin(w, r) == nil {
			return
		}
		next(w, r)
	}
}

func NewServer(cfg *config.Config, projectRoot string) *Server {
	return newServer(cfg, projectRoot, nil)
}

// NewServerWithPowerManager lets the process owner share one explicitly
// managed power assertion with the API without reintroducing a global
// singleton. NewServer remains source-compatible for embedded callers.
func NewServerWithPowerManager(cfg *config.Config, projectRoot string, powerMgr *system.PowerManager) *Server {
	return newServer(cfg, projectRoot, powerMgr)
}

// NewServerWithPowerManagerChecked is the startup-safe constructor used by the
// executable. Authentication storage is required for a usable server; callers
// that can surface an initialization error should use this variant.
func NewServerWithPowerManagerChecked(cfg *config.Config, projectRoot string, powerMgr *system.PowerManager) (*Server, error) {
	s := newServer(cfg, projectRoot, powerMgr)
	if s.authInitErr != nil {
		return nil, s.authInitErr
	}
	return s, nil
}

func newServer(cfg *config.Config, projectRoot string, sharedPowerMgr *system.PowerManager) *Server {
	serverCtx, serverCancel := context.WithCancel(context.Background())
	vmMgr := vm.NewManager(cfg)
	dockerClient := docker.NewClient(vmMgr, projectRoot)
	appMgr := apps.NewManager(vmMgr, dockerClient, projectRoot)
	sambaMgr := samba.NewManager(cfg, vmMgr)
	powerMgr := sharedPowerMgr
	if powerMgr == nil {
		powerMgr = system.GetPowerManager(cfg)
	}
	serviceMgr := system.NewServiceManager(cfg, projectRoot)
	userMgr := system.NewUserManager(vmMgr)
	sshMgr := system.NewSSHManager(vmMgr)
	cfgDir, cfgDirErr := config.ConfigDir()
	var termSettingsMgr *system.TerminalSettingsManager
	if cfgDirErr == nil {
		termSettingsMgr = system.NewTerminalSettingsManager(cfgDir)
	}

	var authMgr *auth.Manager
	authInitErr := cfgDirErr
	if authInitErr == nil {
		authMgr, authInitErr = auth.NewManager(cfgDir)
	}
	if authInitErr != nil {
		log.Printf("[Auth] failed to init auth manager: %v", authInitErr)
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
		authInitErr:     authInitErr,
		projectRoot:     projectRoot,
		allowedOrigins:  configuredOrigins(os.Getenv("MACNAS_ALLOWED_ORIGINS")),
		uploadSlots:     make(chan struct{}, 2),
		mux:             http.NewServeMux(),
		serverCtx:       serverCtx,
		serverCancel:    serverCancel,
	}

	s.registerRoutes()
	return s
}

// Close cancels server-owned background work. HTTP handlers that submit
// long-running VM or mount operations derive their contexts from this root,
// so process shutdown does not leave limactl jobs running indefinitely.
func (s *Server) Close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() {
		s.backgroundMu.Lock()
		s.closing = true
		s.backgroundMu.Unlock()
		if s.serverCancel != nil {
			s.serverCancel()
		}
		done := make(chan struct{})
		go func() {
			s.backgroundWG.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			log.Printf("[MacNAS API] timed out waiting for background operations to stop")
		}
	})
}

func (s *Server) beginBackgroundWork() bool {
	s.backgroundMu.Lock()
	defer s.backgroundMu.Unlock()
	if s.closing {
		return false
	}
	s.backgroundWG.Add(1)
	return true
}

func (s *Server) endBackgroundWork() {
	s.backgroundWG.Done()
}

func (s *Server) operationContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	base := s.serverCtx
	if base == nil {
		base = context.Background()
	}
	return context.WithTimeout(base, timeout)
}

func (s *Server) scheduleMountSync() {
	s.mountSyncMu.Lock()
	if s.mountSyncActive {
		s.mountSyncMu.Unlock()
		return
	}
	s.mountSyncActive = true
	base := s.serverCtx
	if base == nil {
		base = context.Background()
	}
	s.mountSyncMu.Unlock()
	if !s.beginBackgroundWork() {
		s.mountSyncMu.Lock()
		s.mountSyncActive = false
		s.mountSyncMu.Unlock()
		return
	}

	go func() {
		defer s.endBackgroundWork()
		defer func() {
			s.mountSyncMu.Lock()
			s.mountSyncActive = false
			s.mountSyncMu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(base, 2*time.Minute)
		defer cancel()
		if err := s.vmMgr.SyncMounts(ctx); err != nil {
			log.Printf("[MacNAS API] mount sync failed: %v", err)
		}
	}()
}

// beginStorageOperation serializes storage mutations that update both the
// persisted configuration and the generated Lima configuration. Blocking on
// an in-flight disk operation would make a disconnected client hold another
// request open indefinitely, so conflicting writes fail fast with 409.
func (s *Server) beginStorageOperation(w http.ResponseWriter) bool {
	s.storageOpMu.Lock()
	if s.storageOpActive {
		s.storageOpMu.Unlock()
		writeError(w, http.StatusConflict, "已有存储操作正在执行，请稍后重试")
		return false
	}
	s.storageOpActive = true
	s.storageOpMu.Unlock()
	return true
}

func (s *Server) endStorageOperation() {
	s.storageOpMu.Lock()
	s.storageOpActive = false
	s.storageOpMu.Unlock()
}

// beginDockerOperation serializes mutations that share the VM Docker daemon.
// A second long-running install or compose action should fail fast instead of
// racing the first operation and leaving containers, images, or config files
// in an indeterminate state.
func (s *Server) beginDockerOperation(w http.ResponseWriter) bool {
	s.dockerOpMu.Lock()
	if s.dockerOpActive {
		s.dockerOpMu.Unlock()
		writeError(w, http.StatusConflict, "已有 Docker 操作正在执行，请稍后重试")
		return false
	}
	s.dockerOpActive = true
	s.dockerOpMu.Unlock()
	return true
}

func (s *Server) endDockerOperation() {
	s.dockerOpMu.Lock()
	s.dockerOpActive = false
	s.dockerOpMu.Unlock()
	if s.dockerClient != nil {
		s.dockerClient.InvalidateContainerCaches()
	}
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Keep browser defaults restrictive for both the SPA and API responses.
		// These headers are deliberately set before any early return (CORS,
		// OPTIONS, or authentication failure).
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if r.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
			if !s.originAllowed(r, origin) {
				writeError(w, http.StatusForbidden, "跨域来源不被允许")
				return
			}
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0])), "application/json") && r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
		}

		// API Authentication Interceptor
		if strings.HasPrefix(r.URL.Path, "/api/") {
			// Whitelisted unauthenticated endpoints
			if r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/auth/status" || r.URL.Path == "/api/auth/setup" {
				s.mux.ServeHTTP(w, r)
				return
			}
			if s.authMgr == nil {
				if s.authInitErr != nil {
					writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
				} else {
					writeError(w, http.StatusUnauthorized, "请先登录")
				}
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
	s.mux.HandleFunc("POST /api/system/power/toggle", s.adminOnly(s.handleSystemPowerToggle))
	s.mux.HandleFunc("GET /api/system/service", s.handleSystemServiceStatus)
	s.mux.HandleFunc("POST /api/system/service/install", s.adminOnly(s.handleSystemServiceInstall))
	s.mux.HandleFunc("POST /api/system/service/uninstall", s.adminOnly(s.handleSystemServiceUninstall))

	// 2. VM lifecycle & Specs
	s.mux.HandleFunc("POST /api/vm/start", s.adminOnly(s.handleVMStart))
	s.mux.HandleFunc("POST /api/vm/stop", s.adminOnly(s.handleVMStop))
	s.mux.HandleFunc("POST /api/vm/restart", s.adminOnly(s.handleVMRestart))
	s.mux.HandleFunc("GET /api/vm/config", s.handleVMConfigGet)
	s.mux.HandleFunc("POST /api/vm/config", s.adminOnly(s.handleVMConfigUpdate))

	// 3. Storage
	s.mux.HandleFunc("GET /api/storage/disks", s.handleStorageDisks)
	s.mux.HandleFunc("POST /api/storage/select", s.adminOnly(s.handleStorageSelect))
	s.mux.HandleFunc("POST /api/storage/bind", s.adminOnly(s.handleStorageBind))
	s.mux.HandleFunc("POST /api/storage/unbind", s.adminOnly(s.handleStorageUnbind))
	s.mux.HandleFunc("POST /api/storage/bind-secondary", s.adminOnly(s.handleStorageBindSecondary))
	s.mux.HandleFunc("POST /api/storage/unbind-secondary", s.adminOnly(s.handleStorageUnbindSecondary))
	s.mux.HandleFunc("GET /api/storage/mounts", s.handleStorageMountsList)
	s.mux.HandleFunc("POST /api/storage/mounts", s.adminOnly(s.handleStorageMountsAdd))
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/toggle", s.adminOnly(s.handleStorageMountsToggle))
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/writable", s.adminOnly(s.handleStorageMountsWritable))
	s.mux.HandleFunc("DELETE /api/storage/mounts/{id}", s.adminOnly(s.handleStorageMountsDelete))

	// 4. Docker Overview & Containers
	s.mux.HandleFunc("GET /api/docker/overview", s.handleDockerOverview)
	s.mux.HandleFunc("GET /api/docker/containers", s.handleDockerContainers)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/action", s.adminOnly(s.handleDockerContainerAction))
	s.mux.HandleFunc("POST /api/docker/containers/{id}/start", s.adminOnly(s.handleDockerStart))
	s.mux.HandleFunc("POST /api/docker/containers/{id}/stop", s.adminOnly(s.handleDockerStop))
	s.mux.HandleFunc("POST /api/docker/containers/{id}/restart", s.adminOnly(s.handleDockerRestart))
	s.mux.HandleFunc("DELETE /api/docker/containers/{id}", s.adminOnly(s.handleDockerRemoveContainer))
	s.mux.HandleFunc("GET /api/docker/containers/{id}/logs", s.adminOnly(s.handleDockerLogs))

	// Docker Images
	s.mux.HandleFunc("GET /api/docker/images", s.handleDockerImages)
	s.mux.HandleFunc("POST /api/docker/images/pull", s.adminOnly(s.handleDockerPullImage))
	s.mux.HandleFunc("POST /api/docker/images/pull/stream", s.adminOnly(s.handleDockerPullImageStream))
	s.mux.HandleFunc("DELETE /api/docker/images/{id}", s.adminOnly(s.handleDockerRemoveImage))
	s.mux.HandleFunc("POST /api/docker/images/prune", s.adminOnly(s.handleDockerPruneImages))

	// Docker Compose
	s.mux.HandleFunc("GET /api/docker/compose", s.handleDockerComposeList)
	s.mux.HandleFunc("GET /api/docker/compose/{name}", s.handleDockerComposeGetYaml)
	s.mux.HandleFunc("POST /api/docker/compose/deploy", s.adminOnly(s.handleDockerComposeDeploy))
	s.mux.HandleFunc("POST /api/docker/compose/deploy/stream", s.adminOnly(s.handleDockerComposeDeployStream))
	s.mux.HandleFunc("POST /api/docker/compose/{name}/action", s.adminOnly(s.handleDockerComposeAction))
	s.mux.HandleFunc("DELETE /api/docker/compose/{name}", s.adminOnly(s.handleDockerComposeDelete))

	// Docker Networks & Mirrors
	s.mux.HandleFunc("GET /api/docker/networks", s.handleDockerNetworks)
	s.mux.HandleFunc("GET /api/docker/mirrors", s.handleDockerGetMirrors)
	s.mux.HandleFunc("POST /api/docker/mirrors", s.adminOnly(s.handleDockerSetMirrors))

	// 5. Apps
	s.mux.HandleFunc("GET /api/apps", s.handleAppsList)
	s.mux.HandleFunc("GET /api/apps/{id}/config", s.adminOnly(s.handleAppGetConfig))
	s.mux.HandleFunc("POST /api/apps/{id}/install", s.adminOnly(s.handleAppInstall))
	s.mux.HandleFunc("GET /api/apps/{id}/install/stream", s.adminOnly(s.handleAppInstallStream))
	s.mux.HandleFunc("POST /api/apps/{id}/install/custom", s.adminOnly(s.handleAppInstallCustomStream))
	s.mux.HandleFunc("POST /api/apps/custom", s.adminOnly(s.handleAppCustomAdd))
	s.mux.HandleFunc("DELETE /api/apps/custom/{id}", s.adminOnly(s.handleAppCustomDelete))
	s.mux.HandleFunc("POST /api/apps/sync", s.adminOnly(s.handleAppStoreSync))
	s.mux.HandleFunc("POST /api/apps/{id}/start", s.adminOnly(s.handleAppStart))
	s.mux.HandleFunc("POST /api/apps/{id}/stop", s.adminOnly(s.handleAppStop))
	s.mux.HandleFunc("POST /api/apps/{id}/restart", s.adminOnly(s.handleAppRestart))
	s.mux.HandleFunc("POST /api/apps/{id}/uninstall", s.adminOnly(s.handleAppUninstall))
	s.mux.HandleFunc("GET /api/apps/{id}/logs", s.adminOnly(s.handleAppLogs))

	// 6. Samba
	s.mux.HandleFunc("GET /api/samba/status", s.handleSambaStatus)
	s.mux.HandleFunc("POST /api/samba/shares", s.adminOnly(s.handleSambaShareAddOrUpdate))
	s.mux.HandleFunc("PUT /api/samba/shares/{id}", s.adminOnly(s.handleSambaShareAddOrUpdate))
	s.mux.HandleFunc("POST /api/samba/shares/{id}/toggle", s.adminOnly(s.handleSambaShareToggle))
	s.mux.HandleFunc("DELETE /api/samba/shares/{id}", s.adminOnly(s.handleSambaShareDelete))
	s.mux.HandleFunc("POST /api/samba/service/toggle", s.adminOnly(s.handleSambaServiceToggle))
	s.mux.HandleFunc("POST /api/samba/service/restart", s.adminOnly(s.handleSambaServiceRestart))
	s.mux.HandleFunc("POST /api/samba/password", s.adminOnly(s.handleSambaPassword))

	// 7. WebSocket logs
	s.mux.HandleFunc("GET /api/ws/logs", s.adminOnly(s.handleWSLogs))

	// 8. Web Terminal & File System
	s.mux.HandleFunc("GET /api/terminal/ws", s.adminOnly(s.handleTerminalWS))
	s.mux.HandleFunc("GET /api/terminal/files", s.handleTerminalFilesList)
	s.mux.HandleFunc("GET /api/terminal/files/read", s.handleTerminalFileRead)
	s.mux.HandleFunc("POST /api/terminal/files/write", s.adminOnly(s.handleTerminalFileWrite))
	s.mux.HandleFunc("POST /api/terminal/files/mkdir", s.adminOnly(s.handleTerminalFileMkdir))
	s.mux.HandleFunc("POST /api/terminal/files/upload", s.adminOnly(s.handleTerminalFileUpload))
	s.mux.HandleFunc("POST /api/terminal/files/rename", s.adminOnly(s.handleTerminalFileRename))
	s.mux.HandleFunc("DELETE /api/terminal/files", s.adminOnly(s.handleTerminalFileDelete))
	s.mux.HandleFunc("GET /api/terminal/files/download", s.handleTerminalFileDownload)
	s.mux.HandleFunc("GET /api/terminal/files/raw", s.handleTerminalFileRaw)
	s.mux.HandleFunc("POST /api/terminal/files/copy", s.adminOnly(s.handleTerminalFilesCopy))
	s.mux.HandleFunc("POST /api/terminal/files/move", s.adminOnly(s.handleTerminalFilesMove))
	s.mux.HandleFunc("POST /api/terminal/files/trash", s.adminOnly(s.handleTerminalFilesTrash))
	s.mux.HandleFunc("GET /api/terminal/files/trash", s.handleTerminalFilesTrashList)
	s.mux.HandleFunc("POST /api/terminal/files/restore", s.adminOnly(s.handleTerminalFilesRestore))
	s.mux.HandleFunc("POST /api/terminal/files/trash/delete", s.adminOnly(s.handleTerminalFilesTrashDelete))
	s.mux.HandleFunc("POST /api/terminal/files/empty-trash", s.adminOnly(s.handleTerminalFilesEmptyTrash))

	// 9. System Security, Users & SSH
	s.mux.HandleFunc("GET /api/system/users", s.adminOnly(s.handleListUsers))
	s.mux.HandleFunc("POST /api/system/users", s.adminOnly(s.handleCreateUser))
	s.mux.HandleFunc("POST /api/system/users/{username}/password", s.adminOnly(s.handleUpdateUserPassword))
	s.mux.HandleFunc("DELETE /api/system/users/{username}", s.adminOnly(s.handleDeleteUser))
	s.mux.HandleFunc("POST /api/system/root/password", s.adminOnly(s.handleUpdateRootPassword))
	s.mux.HandleFunc("GET /api/system/ssh", s.adminOnly(s.handleGetSSHConfig))
	s.mux.HandleFunc("POST /api/system/ssh", s.adminOnly(s.handleUpdateSSHConfig))
	s.mux.HandleFunc("POST /api/system/ssh/toggle", s.adminOnly(s.handleToggleSSH))
	s.mux.HandleFunc("POST /api/system/ssh/keys/generate", s.adminOnly(s.handleGenerateSSHRootKey))
	s.mux.HandleFunc("GET /api/system/ssh/keys", s.adminOnly(s.handleGetSSHAuthorizedKeys))
	s.mux.HandleFunc("POST /api/system/ssh/keys/add", s.adminOnly(s.handleAddSSHAuthorizedKey))
	s.mux.HandleFunc("DELETE /api/system/ssh/keys", s.adminOnly(s.handleClearSSHAuthorizedKeys))
	s.mux.HandleFunc("GET /api/system/terminal/settings", s.handleGetTerminalSettings)
	s.mux.HandleFunc("POST /api/system/terminal/settings", s.adminOnly(s.handleUpdateTerminalSettings))

	// 10. Web Console Authentication & User Management
	s.mux.HandleFunc("POST /api/auth/login", s.handleAuthLogin)
	s.mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	s.mux.HandleFunc("POST /api/auth/setup", s.handleAuthSetup)
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
	if status >= http.StatusInternalServerError {
		// Service errors can contain host paths, command output, or other
		// implementation details. Keep those in server logs only and expose a
		// stable response to clients.
		logMsg := strings.NewReplacer("\r", "\\r", "\n", "\\n").Replace(msg)
		if len(logMsg) > 2048 {
			logMsg = logMsg[:2048] + "…"
		}
		log.Printf("[MacNAS API] internal error: %s", logMsg)
		msg = "服务器内部错误"
	}
	writeJSON(w, status, map[string]string{"error": msg})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, rememberMe bool) {
	maxAge := int((24 * time.Hour) / time.Second)
	if rememberMe {
		maxAge = int((30 * 24 * time.Hour) / time.Second)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		Expires:  time.Now().Add(time.Duration(maxAge) * time.Second),
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteStrictMode,
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteStrictMode,
	})
}

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
		"system":      sysStats,
		"power":       s.powerMgr.GetStatus(),
		"service":     s.serviceMgr.GetStatus(),
		"vm":          vmStat,
		"vmAction":    s.vmMgr.GetVMAction(),
		"configDirty": s.vmMgr.IsConfigDirty(),
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

// VM Handlers
func (s *Server) handleVMStart(w http.ResponseWriter, r *http.Request) {
	if !s.vmMgr.BeginVMAction("starting") {
		writeError(w, http.StatusConflict, "已有虚拟机操作正在进行")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		ctx, cancel := s.operationContext(10 * time.Minute)
		defer cancel()
		if err := s.vmMgr.Start(ctx, s.projectRoot); err != nil {
			log.Printf("[MacNAS] VM Start error: %v", err)
		} else {
			s.vmMgr.SetConfigDirty(false)
			if err := s.sambaMgr.EnsurePassword(ctx); err != nil {
				log.Printf("[MacNAS] ensure Samba password after VM start failed: %v", err)
			}
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "starting", "message": "虚拟机启动中..."})
}

func (s *Server) handleVMStop(w http.ResponseWriter, r *http.Request) {
	if !s.vmMgr.BeginVMAction("stopping") {
		writeError(w, http.StatusConflict, "已有虚拟机操作正在进行")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		ctx, cancel := s.operationContext(2 * time.Minute)
		defer cancel()
		if err := s.vmMgr.Stop(ctx); err != nil {
			log.Printf("[MacNAS] VM Stop error: %v", err)
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "stopping", "message": "虚拟机停止中..."})
}

func (s *Server) handleVMRestart(w http.ResponseWriter, r *http.Request) {
	if !s.vmMgr.BeginVMAction("restarting") {
		writeError(w, http.StatusConflict, "已有虚拟机操作正在进行")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		ctx, cancel := s.operationContext(10 * time.Minute)
		defer cancel()
		if err := s.vmMgr.Restart(ctx, s.projectRoot); err != nil {
			log.Printf("[MacNAS] VM Restart error: %v", err)
		} else {
			s.vmMgr.SetConfigDirty(false)
			if err := s.sambaMgr.EnsurePassword(ctx); err != nil {
				log.Printf("[MacNAS] ensure Samba password after VM restart failed: %v", err)
			}
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting", "message": "虚拟机重启中..."})
}

// Storage Handlers
func (s *Server) regenerateVMConfig() error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return err
	}
	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	return s.vmMgr.GenerateConfigFile(tmplPath, filepath.Join(cfgDir, "macnas.yaml"))
}

func (s *Server) restoreConfigSnapshot(snapshot *config.Config) error {
	if snapshot == nil {
		return fmt.Errorf("配置快照为空")
	}
	return config.Update(s.cfg, func(updated *config.Config) error {
		*updated = *snapshot
		return nil
	})
}

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
		log.Printf("[MacNAS Storage] managed disk discovery failed: %v", managedErr)
		writeError(w, http.StatusInternalServerError, "读取 Lima 磁盘列表失败")
		return
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

func (s *Server) handleStorageSelect(w http.ResponseWriter, r *http.Request) {
	if !s.beginStorageOperation(w) {
		return
	}
	defer s.endStorageOperation()

	var body struct {
		Identifier string `json:"identifier"` // e.g. "disk4" or "/dev/disk4"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	identifier, err := storage.NormalizeDiskIdentifier(body.Identifier)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := config.Update(s.cfg, func(updated *config.Config) error {
		updated.Storage.SelectedDisk = identifier
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	storage.InvalidateDisksCache()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":       "success",
		"selectedDisk": identifier,
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if err := s.dockerClient.RemoveContainer(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerStart(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.dockerClient.StartContainer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerStop(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.dockerClient.StopContainer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerRestart(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
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
	tail := docker.NormalizeLogTail(0)
	if n, err := strconv.Atoi(tailStr); err == nil && n > 0 {
		tail = docker.NormalizeLogTail(n)
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	var buf cappedBuffer
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}
	err := s.dockerClient.PullImage(r.Context(), req.Image, sw)
	if err != nil {
		log.Printf("[MacNAS] Docker image pull stream failed: %v", err)
		_ = writeSSEEvent(w, flusher, "error", map[string]string{"error": "镜像拉取失败"})
	} else {
		_ = writeSSEEvent(w, flusher, "done", map[string]string{
			"status": "success",
			"image":  strings.TrimSpace(req.Image),
		})
	}
}

func (s *Server) handleDockerRemoveImage(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if err := s.dockerClient.RemoveImage(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerPruneImages(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	var buf cappedBuffer
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}
	err := s.dockerClient.DeployCompose(r.Context(), req.Name, req.YAML, sw)
	if err != nil {
		log.Printf("[MacNAS] Compose deploy stream failed: %v", err)
		_ = writeSSEEvent(w, flusher, "error", map[string]string{"error": "Compose 部署失败"})
	} else {
		_ = writeSSEEvent(w, flusher, "done", map[string]string{
			"status": "success",
			"name":   strings.TrimSpace(req.Name),
		})
	}
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	var buf cappedBuffer
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	name := r.PathValue("name")
	deleteVolumes := r.URL.Query().Get("volumes") == "true"
	if deleteVolumes && r.URL.Query().Get("confirm") != "DELETE_DATA" {
		writeError(w, http.StatusBadRequest, "删除 Compose 数据卷需要显式确认")
		return
	}
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
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

const maxBufferedCommandOutputBytes = 4 << 20

type cappedBuffer struct {
	mu        sync.Mutex
	buf       bytes.Buffer
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	remaining := maxBufferedCommandOutputBytes - b.buf.Len()
	if remaining > 0 {
		if len(p) <= remaining {
			_, _ = b.buf.Write(p)
		} else {
			_, _ = b.buf.Write(p[:remaining])
			b.truncated = true
		}
	} else {
		b.truncated = true
	}
	return len(p), nil
}

func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	result := b.buf.String()
	if b.truncated {
		result += "\n[输出已截断，日志超过 4 MiB 上限]\n"
	}
	return result
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

func (s *Server) handleAppInstallStream(w http.ResponseWriter, r *http.Request) {
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
	portStr := r.URL.Query().Get("port")
	port := 0
	if portStr != "" {
		fmt.Sscanf(portStr, "%d", &port)
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}

	ctx := r.Context()
	err := s.appMgr.InstallStream(ctx, id, port, sw)
	if err != nil {
		log.Printf("[MacNAS] app install stream failed for %q: %v", id, err)
		_ = writeSSEEvent(w, flusher, "error", map[string]string{"error": "应用安装失败"})
	} else {
		_ = writeSSEEvent(w, flusher, "done", map[string]string{"status": "success", "id": id})
	}
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
		log.Printf("[MacNAS] custom app install stream failed for %q: %v", id, err)
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

	upgrader := s.websocketUpgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(64 << 10)

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
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteJSON(msg); err != nil {
					return
				}
			}
		}
	}
}

// VM Hardware Specs Configuration Handlers
func (s *Server) handleVMConfigGet(w http.ResponseWriter, r *http.Request) {
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取虚拟机配置失败")
		return
	}
	totalMemGB := 16
	if vMem, err := mem.VirtualMemory(); err == nil && vMem.Total > 0 {
		totalMemGB = int(vMem.Total / 1024 / 1024 / 1024)
	}

	vmStat, _ := s.vmMgr.GetStatusContext(r.Context())
	vmStatus := "unknown"
	if vmStat != nil {
		vmStatus = vmStat.Status
	}

	resp := map[string]interface{}{
		"cpus":               cfgSnapshot.VM.CPUs,
		"memory":             cfgSnapshot.VM.Memory,
		"diskSize":           cfgSnapshot.VM.DiskSize,
		"hostCpus":           runtime.NumCPU(),
		"hostMemoryGB":       totalMemGB,
		"vmStatus":           vmStatus,
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
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取虚拟机配置失败")
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

	if req.DiskSize < cfgSnapshot.VM.DiskSize {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("系统盘容量只支持扩容（当前为 %d GiB，不能缩减）", cfgSnapshot.VM.DiskSize))
		return
	}

	if err := s.vmMgr.UpdateSpecs(req.CPUs, req.Memory, req.DiskSize, s.projectRoot); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updatedConfig, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取更新后的虚拟机配置失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"requiresRestart": true,
		"message":         "虚拟机硬件规格已更新！请重启虚拟机以加载新配置生效。",
		"cpus":            updatedConfig.VM.CPUs,
		"memory":          updatedConfig.VM.Memory,
		"diskSize":        updatedConfig.VM.DiskSize,
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
	terminal.HandleTerminalWS(w, r, s.vmMgr.InstanceName(), s.allowedOrigins)
}

// File System Handlers
func (s *Server) handleTerminalFilesList(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		targetPath = "/data"
	}

	items, err := terminal.ListFilesContext(r.Context(), s.vmMgr.InstanceName(), targetPath)
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

	content, err := terminal.ReadFileContext(r.Context(), s.vmMgr.InstanceName(), filePath)
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

	if err := terminal.WriteFileContext(r.Context(), s.vmMgr.InstanceName(), req.Path, req.Content); err != nil {
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

	if err := terminal.CreateDirContext(r.Context(), s.vmMgr.InstanceName(), req.Path); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "文件夹创建成功"})
}

func (s *Server) handleTerminalFileUpload(w http.ResponseWriter, r *http.Request) {
	const maxUploadSize int64 = 10 << 30
	if r.ContentLength > maxUploadSize {
		writeError(w, http.StatusRequestEntityTooLarge, "上传文件不能超过 10 GiB")
		return
	}
	if s.uploadSlots != nil {
		select {
		case s.uploadSlots <- struct{}{}:
			defer func() { <-s.uploadSlots }()
		default:
			writeError(w, http.StatusTooManyRequests, "当前已有多个文件在上传，请稍后重试")
			return
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	// Keep the destination outside the multipart body so the upload can be
	// streamed directly to the VM without ParseMultipartForm spooling it to
	// the host's temporary directory.
	targetDir := r.URL.Query().Get("targetDir")
	if targetDir == "" {
		targetDir = "/data"
	}

	if err := terminal.UploadFile(w, r, s.vmMgr.InstanceName(), targetDir); err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "request body too large") {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(w, status, err.Error())
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

	if err := terminal.DeletePathContext(r.Context(), s.vmMgr.InstanceName(), targetPath); err != nil {
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

	terminal.DownloadFile(w, r, s.vmMgr.InstanceName(), targetPath)
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

	if err := terminal.RenamePathContext(r.Context(), s.vmMgr.InstanceName(), req.OldPath, req.NewPath); err != nil {
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

	terminal.StreamMediaFile(w, r, s.vmMgr.InstanceName(), targetPath)
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

	if err := terminal.CopyPathsContext(r.Context(), s.vmMgr.InstanceName(), req.SrcPaths, req.DestDir); err != nil {
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

	if err := terminal.MovePathsContext(r.Context(), s.vmMgr.InstanceName(), req.SrcPaths, req.DestDir); err != nil {
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

	if err := terminal.MoveToTrashContext(r.Context(), s.vmMgr.InstanceName(), req.Paths); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已将 %d 个项目移入回收站", len(req.Paths)),
	})
}

func (s *Server) handleTerminalFilesTrashList(w http.ResponseWriter, r *http.Request) {
	items, err := terminal.ListTrashContext(r.Context(), s.vmMgr.InstanceName())
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

	if err := terminal.RestoreTrashContext(r.Context(), s.vmMgr.InstanceName(), req.IDs); err != nil {
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

	count, err := terminal.DeleteTrashItemsContext(r.Context(), s.vmMgr.InstanceName(), req.IDs)
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
	count, err := terminal.EmptyTrashContext(r.Context(), s.vmMgr.InstanceName())
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

// -------------------------------------------------------------
// 10. Web Console Auth & User Management Handlers
// -------------------------------------------------------------

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if s.authMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
		return
	}
	var req struct {
		Username   string `json:"username"`
		Password   string `json:"password"`
		RememberMe bool   `json:"rememberMe"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数解析错误")
		return
	}

	token, user, err := s.authMgr.LoginFrom(req.Username, req.Password, req.RememberMe, requestIP(r))
	if err != nil {
		if errors.Is(err, auth.ErrTooManyLoginAttempts) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, err.Error())
			return
		}
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	setSessionCookie(w, r, token, req.RememberMe)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": user,
	})
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if s.authMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"setupRequired": s.authMgr.NeedsSetup()})
}

func (s *Server) handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "首次管理员初始化仅允许在 MacNAS 主机本机执行")
		return
	}
	if s.authMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
		return
	}
	var req auth.CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}
	req.Role = "admin"
	user, err := s.authMgr.CreateInitialAdmin(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "ok",
		"user":   user,
	})
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == "" {
		if sessionCookie, err := r.Cookie(sessionCookieName); err == nil {
			token = sessionCookie.Value
		}
	}
	if token != "" && s.authMgr != nil {
		s.authMgr.Logout(token)
	}
	clearSessionCookie(w, r)
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
