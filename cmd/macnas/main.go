package main

import (
	"context"
	"flag"
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

	"github.com/luluen/mac-nas/pkg/api"
	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/system"
	"github.com/luluen/mac-nas/web"
)

func main() {
	// Determine project root directory first
	exePath, err := os.Executable()
	projectRoot := "."
	if err == nil {
		dir := filepath.Dir(exePath)
		if _, err := os.Stat(filepath.Join(dir, "templates")); err == nil {
			projectRoot = dir
		} else if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "templates")); err == nil {
			projectRoot = filepath.Dir(dir)
		} else if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "Resources", "templates")); err == nil {
			// macOS app bundles keep packaged templates in Contents/Resources.
			projectRoot = filepath.Join(filepath.Dir(dir), "Resources")
		} else if cwd, err := os.Getwd(); err == nil {
			projectRoot = cwd
		}
	} else if cwd, err := os.Getwd(); err == nil {
		projectRoot = cwd
	}

	cfg, err := config.LoadConfig()
	if err != nil {
		// Do not silently run with defaults when the persisted configuration is
		// unreadable or invalid. That can change listen/storage/auth behavior
		// without the operator realizing it and may overwrite the wrong state.
		log.Fatalf("[MacNAS] 无法加载安全配置，服务未启动: %v", err)
	}

	// Check CLI subcommand: macnas service [install|uninstall|status]
	if len(os.Args) > 1 && os.Args[1] == "service" {
		serviceMgr := system.NewServiceManager(cfg, projectRoot)
		action := "status"
		if len(os.Args) > 2 {
			action = os.Args[2]
		}

		switch action {
		case "install":
			port := cfg.Port
			if port <= 0 {
				port = 19808
			}
			if err := serviceMgr.Install(port); err != nil {
				log.Fatalf("[MacNAS Service] 安装自启服务失败: %v", err)
			}
			fmt.Println("✅ MacNAS LaunchAgent 开机免登录自启服务已成功安装并启动！")
			fmt.Printf("   配置文件: ~/Library/LaunchAgents/%s.plist\n", system.ServiceLabel)
			return
		case "uninstall":
			if err := serviceMgr.Uninstall(); err != nil {
				log.Fatalf("[MacNAS Service] 卸载自启服务失败: %v", err)
			}
			fmt.Println("✅ MacNAS LaunchAgent 开机自启服务已成功卸载。")
			return
		case "status":
			status := serviceMgr.GetStatus()
			fmt.Printf("MacNAS LaunchAgent 服务状态:\n")
			fmt.Printf("  服务标识: %s\n", status.Label)
			fmt.Printf("  已安装:   %v\n", status.Installed)
			fmt.Printf("  运行中:   %v\n", status.Running)
			fmt.Printf("  Plist:    %s\n", status.PlistPath)
			fmt.Printf("  日志文件: %s\n", status.LogPath)
			return
		default:
			fmt.Printf("用法: macnas service [install|uninstall|status]\n")
			os.Exit(1)
		}
	}

	portFlag := flag.Int("port", 0, "Server port (default from config or 19808)")
	hostFlag := flag.String("host", "", "Listen address (default from config or 127.0.0.1)")
	webDirFlag := flag.String("web", "", "Directory containing web frontend build (default: web/dist)")
	flag.Parse()

	port := cfg.Port
	if *portFlag > 0 {
		port = *portFlag
	}
	if port <= 0 {
		port = 19808
	}
	listenAddress := config.NormalizeListenAddress(cfg.ListenAddress)
	if *hostFlag != "" {
		listenAddress = config.NormalizeListenAddress(*hostFlag)
	}
	// The CLI override is intentionally ephemeral, but the VM manager must use
	// the same bind address while this process is running.
	cfg.ListenAddress = listenAddress

	// Resolve web dir
	webDir := *webDirFlag
	if webDir == "" {
		webDir = filepath.Join(projectRoot, "web", "dist")
	}

	// Initialize power manager for 24h keep-awake
	powerMgr := system.GetPowerManager(cfg)
	if cfg.System.PreventSleep {
		_ = powerMgr.Start()
	}

	server, err := api.NewServerWithPowerManagerChecked(cfg, projectRoot, powerMgr)
	if err != nil {
		log.Fatalf("[MacNAS] 认证服务初始化失败，服务未启动: %v", err)
	}
	apiHandler := server.Handler()

	embeddedFS := web.GetFS()
	fileServer := http.FileServer(http.FS(embeddedFS))

	// Main HTTP Handler with SPA fallback
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

		// Try embedded FS first
		f, err := embeddedFS.Open(strings.TrimPrefix(r.URL.Path, "/"))
		if err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// Fallback to local directory if customized
		if info, err := os.Stat(webDir); err == nil && info.IsDir() {
			if targetFile, ok := safeWebPath(webDir, r.URL.Path); ok {
				fInfo, err := os.Stat(targetFile)
				if err == nil && !fInfo.IsDir() {
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

		// SPA fallback to embedded index.html
		if indexF, err := embeddedFS.Open("index.html"); err == nil {
			_ = indexF.Close()
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head><title>MacNAS Server</title></head>
<body style="font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
  <h1 style="font-size: 32px; margin-bottom: 12px;">🍎 MacNAS 服务运行中</h1>
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

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[MacNAS] HTTP server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[MacNAS] 正在平稳关闭服务...")
	_ = powerMgr.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("[MacNAS] 强制退出: %v", err)
	}
	server.Close()
	log.Println("[MacNAS] 服务已停止。")
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
	fmt.Println("  Mac mini 家庭微型服务器控制中心 (MVP v0.1)")
	fmt.Println("===================================================================")
	fmt.Printf("  ➜ 本地访问地址:  http://localhost:%d\n", port)
	if parsedIP := net.ParseIP(listenAddress); parsedIP != nil && parsedIP.IsLoopback() {
		fmt.Printf("  ➜ 当前监听范围:    仅本机 (%s)\n", listenAddress)
	} else {
		fmt.Printf("  ➜ 局域网访问:    http://%s:%d\n", ip, port)
		fmt.Printf("  ➜ SMB 共享地址:  smb://%s:4455/MacNAS\n", ip)
	}
	fmt.Println("===================================================================")
	fmt.Println()
}
