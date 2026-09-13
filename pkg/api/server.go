package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/lulalulaluobo/macbox/pkg/apps"
	"github.com/lulalulaluobo/macbox/pkg/auth"
	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/docker"
	"github.com/lulalulaluobo/macbox/pkg/samba"
	"github.com/lulalulaluobo/macbox/pkg/system"
	"github.com/lulalulaluobo/macbox/pkg/terminal"
	"github.com/lulalulaluobo/macbox/pkg/vm"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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
	terminalMgr     *terminal.SessionManager
	authMgr         *auth.Manager
	authInitErr     error
	projectRoot     string
	allowedOrigins  map[string]struct{}
	allowedHosts    map[string]struct{}
	trustedProxies  []*net.IPNet
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
	backupRestoreMu sync.Mutex
	jobs            *jobManager
	cloudAuthMu     sync.Mutex
	quarkQR         map[string]*quarkQRSession
}

type contextKey string

const userContextKey contextKey = "macbox-user"

// JSON requests are control-plane operations. Keep them small so malformed
// or hostile payloads cannot make every handler allocate unbounded memory.
// Multipart file uploads use their own, much larger limit in the upload
// handler and are deliberately not covered by this cap.
const maxJSONBodyBytes = 8 << 20

const sessionCookieName = "macbox_session"

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

// configuredHosts contains optional DNS names used by a reverse proxy. IP
// literals and localhost are accepted by default because they cannot be
// changed by DNS rebinding. Host names must be explicitly registered so a
// malicious page cannot turn a rebinding domain into a same-origin request.
func configuredHosts(raw string) map[string]struct{} {
	hosts := make(map[string]struct{})
	for _, host := range strings.Split(raw, ",") {
		host = normalizeRequestHost(host)
		if host != "" {
			hosts[host] = struct{}{}
		}
	}
	return hosts
}

func normalizeRequestHost(raw string) string {
	host := strings.ToLower(strings.TrimSpace(raw))
	if host == "" || strings.ContainsAny(host, "\r\n") {
		return ""
	}
	if parsed, _, err := net.SplitHostPort(host); err == nil {
		host = parsed
	} else if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	}
	return strings.TrimSuffix(host, ".")
}

func (s *Server) hostAllowed(r *http.Request) bool {
	// Hand-built Server values are used by package-level unit tests. Production
	// constructors always initialize this map, so a nil map remains a safe
	// compatibility default for embedded callers that predate Host filtering.
	if s.allowedHosts == nil {
		return true
	}
	host := normalizeRequestHost(r.Host)
	if host == "" || host == "0.0.0.0" || host == "::" {
		return false
	}
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return !ip.IsUnspecified()
	}
	_, ok := s.allowedHosts[host]
	return ok
}

func (s *Server) originAllowed(r *http.Request, origin string) bool {
	// Same-origin requests are always allowed. Cross-origin development or
	// reverse-proxy deployments must opt in via MACBOX_ALLOWED_ORIGINS.
	if origin == "http://"+r.Host || origin == "https://"+r.Host {
		return true
	}
	_, ok := s.allowedOrigins[origin]
	return ok
}

func directRequestIP(r *http.Request) net.IP {
	host := r.RemoteAddr
	if parsedHost, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = parsedHost
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip
	}
	return nil
}

func configuredProxies(raw string) []*net.IPNet {
	var networks []*net.IPNet
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if ip := net.ParseIP(entry); ip != nil {
			bits := 128
			if ip.To4() != nil {
				bits = 32
			}
			networks = append(networks, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
			continue
		}
		if _, network, err := net.ParseCIDR(entry); err == nil {
			networks = append(networks, network)
		} else {
			log.Printf("[MacBox API] ignoring invalid MACBOX_TRUSTED_PROXIES entry %q", entry)
		}
	}
	return networks
}

func (s *Server) proxyTrusted(ip net.IP) bool {
	for _, network := range s.trustedProxies {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func (s *Server) requestIP(r *http.Request) string {
	direct := directRequestIP(r)
	if direct == nil {
		return "unknown"
	}
	if !s.proxyTrusted(direct) {
		return direct.String()
	}
	var candidate net.IP
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		ip := net.ParseIP(strings.TrimSpace(parts[i]))
		if ip == nil {
			continue
		}
		candidate = ip
		if !s.proxyTrusted(ip) {
			break
		}
	}
	if candidate == nil {
		return "unknown"
	}
	return candidate.String()
}

func (s *Server) isLoopbackRequest(r *http.Request) bool {
	return net.ParseIP(s.requestIP(r)).IsLoopback()
}

func (s *Server) requestIsHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if !s.proxyTrusted(directRequestIP(r)) {
		return false
	}
	proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	return strings.EqualFold(proto, "https")
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
	// The web service may be launched by Finder or a menu-bar helper, whose
	// environment does not include Homebrew's limactl directory. Prepare the
	// process environment before storage, terminal, and VM helpers execute
	// commands by name.
	vm.PrepareLimaEnvironment()
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
	jobsPath := ""
	if cfgDirErr == nil {
		jobsPath = filepath.Join(cfgDir, "jobs.json")
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
		terminalMgr:     terminal.NewSessionManager(),
		authMgr:         authMgr,
		authInitErr:     authInitErr,
		projectRoot:     projectRoot,
		allowedOrigins:  configuredOrigins(os.Getenv("MACBOX_ALLOWED_ORIGINS")),
		allowedHosts:    configuredHosts(os.Getenv("MACBOX_ALLOWED_HOSTS")),
		trustedProxies:  configuredProxies(os.Getenv("MACBOX_TRUSTED_PROXIES")),
		uploadSlots:     make(chan struct{}, 2),
		mux:             http.NewServeMux(),
		serverCtx:       serverCtx,
		serverCancel:    serverCancel,
		jobs:            newJobManager(jobsPath),
		quarkQR:         make(map[string]*quarkQRSession),
	}

	s.registerRoutes()
	return s
}

// StartMaintenance runs compatibility work that should happen once after a
// backend upgrade. If the VM is stopped, the same migrations are applied by
// the VM start/restart handlers when it becomes available.
func (s *Server) StartMaintenance() {
	if s == nil || !s.beginBackgroundWork() {
		return
	}
	go func() {
		defer s.endBackgroundWork()
		ctx, cancel := s.operationContext(2 * time.Minute)
		defer cancel()
		status, err := s.vmMgr.GetStatusContext(ctx)
		if err != nil || status == nil || status.Status != "Running" {
			return
		}
		s.migrateManagedApps(ctx)
	}()
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
		if s.terminalMgr != nil {
			s.terminalMgr.Close()
		}
		done := make(chan struct{})
		go func() {
			s.backgroundWG.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			log.Printf("[MacBox API] timed out waiting for background operations to stop")
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
	// Adding, removing, or changing a VirtioFS mount rewrites the Lima
	// configuration. Lima only exposes the new source after the VM restarts;
	// attempting to run the guest bind script against the still-running VM
	// waits for a source that cannot exist yet and makes Docker-backed pages
	// look unavailable. Start/Restart performs the sync once the new VM is
	// ready, so defer background sync while configuration is pending.
	if s.vmMgr.IsConfigDirty() {
		log.Printf("[MacBox API] mount sync deferred until the VM restarts")
		return
	}
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
			log.Printf("[MacBox API] mount sync failed: %v", err)
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
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'")
		if s.requestIsHTTPS(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && !s.hostAllowed(r) {
			writeError(w, http.StatusMisdirectedRequest, "请求 Host 未被允许，请使用 MacBox 的局域网地址")
			return
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
			if r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/auth/status" || r.URL.Path == "/api/auth/setup" ||
				(r.URL.Path == "/api/system/backup/restore" && s.authMgr != nil && s.authMgr.NeedsSetup() && s.isLoopbackRequest(r)) ||
				(r.URL.Path == "/api/system/menubar-status" && s.isLoopbackRequest(r)) {
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
		log.Printf("[MacBox API] internal error: %s", logMsg)
		msg = "服务器内部错误"
	}
	writeJSON(w, status, map[string]string{"error": msg})
}
