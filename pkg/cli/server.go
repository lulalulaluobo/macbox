package cli

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/api"
	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/system"
	"github.com/lulalulaluobo/macbox/web"
	"github.com/spf13/cobra"
)

// runServer hosts the HTTP API + embedded SPA. Invoked when macbox runs
// without a control subcommand (and by legacy `macbox -port N` launches).
func runServer(cmd *cobra.Command, args []string) error {
	cfg, err := config.LoadConfig()
	if err != nil {
		// Do not silently run with defaults when the persisted configuration is
		// unreadable or invalid. That can change listen/storage/auth behavior
		// without the operator realizing it and may overwrite the wrong state.
		return fmt.Errorf("无法加载安全配置，服务未启动: %w", err)
	}
	projectRoot := resolveProjectRoot()

	port := effectivePort(cfg)
	listenAddress := config.NormalizeListenAddress(cfg.ListenAddress)
	if serverOpts.lan && serverOpts.host != "" && config.NormalizeListenAddress(serverOpts.host) != "0.0.0.0" {
		return fmt.Errorf("--lan 与 --host 不能同时指定不同监听地址")
	}
	if serverOpts.host != "" {
		listenAddress = config.NormalizeListenAddress(serverOpts.host)
	}
	if serverOpts.lan {
		listenAddress = "0.0.0.0"
	}
	// The CLI override is intentionally ephemeral, but the VM manager must use
	// the same bind address while this process is running.
	cfg.ListenAddress = listenAddress
	if serverOpts.noOpen {
		cfg.System.NoOpen = true
	}

	webDir := serverOpts.webDir
	if webDir == "" {
		webDir = filepath.Join(projectRoot, "web", "dist")
	}

	powerMgr := system.GetPowerManager(cfg)
	if cfg.System.PreventSleep {
		_ = powerMgr.Start()
	}

	server, err := api.NewServerWithPowerManagerChecked(cfg, projectRoot, powerMgr)
	if err != nil {
		return fmt.Errorf("认证服务初始化失败，服务未启动: %w", err)
	}
	server.StartMaintenance()
	apiHandler := server.Handler()

	embeddedFS := web.GetFS()
	fileServer := http.FileServer(http.FS(embeddedFS))

	mainHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			apiHandler.ServeHTTP(w, r)
			return
		}

		// Disable browser caching for SPA HTML entrypoints to prevent stale versions
		if r.URL.Path == "/" || r.URL.Path == "/index.html" || !strings.Contains(r.URL.Path, ".") {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
		}

		if f, err := embeddedFS.Open(strings.TrimPrefix(r.URL.Path, "/")); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		if info, err := os.Stat(webDir); err == nil && info.IsDir() {
			if targetFile, ok := safeWebPath(webDir, r.URL.Path); ok {
				if fInfo, err := os.Stat(targetFile); err == nil && !fInfo.IsDir() {
					http.ServeFile(w, r, targetFile)
					return
				}
			}
			indexFile := filepath.Join(webDir, "index.html")
			if _, err := os.Stat(indexFile); err == nil {
				http.ServeFile(w, r, indexFile)
				return
			}
		}

		if indexF, err := embeddedFS.Open("index.html"); err == nil {
			_ = indexF.Close()
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head><title>MacBox Server</title></head>
<body style="font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
  <h1 style="font-size: 32px; margin-bottom: 12px;">🍎 MacBox 服务运行中</h1>
  <p style="color: #94a3b8; font-size: 16px;">API 服务已在 <code>/api</code> 正常就绪。</p>
  <p><a href="/api/system/status" style="color: #38bdf8;">查看系统状态 API: /api/system/status</a></p>
</body>
</html>`)
	})

	sysStats, _ := system.GetSystemStats()
	primaryIP := "localhost"
	if sysStats != nil && sysStats.PrimaryIP != "" {
		primaryIP = sysStats.PrimaryIP
	}

	addr := net.JoinHostPort(listenAddress, strconv.Itoa(port))
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           mainHandler,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    1 << 20,
		// Do not apply a short global read/write deadline: uploads, downloads,
		// media streams and log streams are intentionally long-lived. Individual
		// handlers enforce their own body and process limits.
		IdleTimeout: 60 * time.Second,
	}

	printBanner(port, primaryIP, listenAddress)

	errCh := make(chan error, 1)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return fmt.Errorf("HTTP server error: %w", err)
	case <-quit:
	}

	log.Println("[MacBox] 正在平稳关闭服务...")
	_ = powerMgr.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("[MacBox] 强制退出: %v", err)
	}
	server.Close()
	log.Println("[MacBox] 服务已停止。")
	return nil
}

func safeWebPath(root, requestPath string) (string, bool) {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", false
	}
	cleanRequest := filepath.Clean(filepath.FromSlash("/" + requestPath))
	relative := strings.TrimPrefix(cleanRequest, string(filepath.Separator))
	target := filepath.Join(rootAbs, relative)
	rel, err := filepath.Rel(rootAbs, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return target, true
}

func printBanner(port int, ip string, listenAddress string) {
	fmt.Println()
	fmt.Println("===================================================================")
	fmt.Println("      __  __            _   _           _____ ")
	fmt.Println("     |  \\/  |          | \\ | |   /\\    / ____|")
	fmt.Println("     | \\  / | __ _  ___|  \\| |  /  \\  | (___  ")
	fmt.Println("     | |\\/| |/ _` |/ __| . ` | / /\\ \\  \\___ \\ ")
	fmt.Println("     | |  | | (_| | (__| |\\  |/ ____ \\ ____) |")
	fmt.Println("     |_|  |_|\\__,_|\\___|_| \\_/_/    \\_\\_____/ ")
	fmt.Println("                                           ")
	fmt.Println("  MacBox 家庭文件中心与开发工作台 (MVP v0.1)")
	fmt.Println("===================================================================")
	fmt.Printf("  ➜ 本地访问地址:  http://localhost:%d\n", port)
	if parsedIP := net.ParseIP(listenAddress); parsedIP != nil && parsedIP.IsLoopback() {
		fmt.Printf("  ➜ 当前监听范围:    仅本机 (%s)\n", listenAddress)
	} else {
		fmt.Printf("  ➜ 局域网访问:    http://%s:%d\n", ip, port)
		fmt.Printf("  ➜ SMB 共享地址:  smb://%s:4455/MacBox\n", ip)
	}
	fmt.Println("===================================================================")
	fmt.Println()
}
