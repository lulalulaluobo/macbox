// Package cli implements the macbox command-line entry point. The same
// binary runs the HTTP server (default, no subcommand) and acts as a local
// control CLI: process/launchd management deliberately bypasses the HTTP API
// so the tools keep working while the server is down.
package cli

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/spf13/cobra"
)

type serverFlags struct {
	port   int
	host   string
	lan    bool
	webDir string
	noOpen bool
}

var serverOpts serverFlags

// Execute runs the macbox CLI and returns the process exit code.
func Execute() int {
	root := newRootCommand()
	root.SetArgs(normalizeLegacyArgs(os.Args[1:]))
	if err := root.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "MacBox: %v\n", err)
		return 1
	}
	return 0
}

// normalizeLegacyArgs keeps pre-cobra invocations working. The menu-bar app
// and old LaunchAgent plists pass single-dash flags like `-port 19808`, and
// `macbox service install|uninstall|status` predates the split autostart
// commands, so map them onto `autostart --web`.
func normalizeLegacyArgs(args []string) []string {
	if len(args) > 0 && args[0] == "service" {
		action := "status"
		extra := []string(nil)
		if len(args) > 1 {
			action = args[1]
			extra = args[2:]
		}
		switch action {
		case "install":
			return append([]string{"autostart", "enable", "--web"}, extra...)
		case "uninstall":
			return append([]string{"autostart", "disable", "--web"}, extra...)
		case "status":
			return append([]string{"autostart", "status"}, extra...)
		default:
			return args
		}
	}

	known := map[string]bool{"-port": true, "-host": true, "-lan": true, "-web": true, "-no-open": true}
	out := make([]string, 0, len(args))
	for _, arg := range args {
		name := arg
		if idx := strings.Index(arg, "="); idx > 0 {
			name = arg[:idx]
		}
		if known[name] {
			out = append(out, "-"+arg)
			continue
		}
		out = append(out, arg)
	}
	return out
}

func newRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:           "macbox",
		Short:         "MacBox 家庭服务器：默认启动 Web 服务，也可通过子命令进行本地控制",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE:          runServer,
	}
	root.Flags().IntVar(&serverOpts.port, "port", 0, "监听端口（默认取配置文件或 19808）")
	root.Flags().StringVar(&serverOpts.host, "host", "", "监听地址（默认取配置文件或 127.0.0.1）")
	root.Flags().BoolVar(&serverOpts.lan, "lan", false, "监听 0.0.0.0 开放局域网访问")
	root.Flags().StringVar(&serverOpts.webDir, "web", "", "前端静态目录（默认使用内嵌资源）")
	root.Flags().BoolVar(&serverOpts.noOpen, "no-open", false, "通知菜单栏 App 启动后不自动打开网页")

	root.AddCommand(newStatusCommand())
	root.AddCommand(newWebCommand())
	root.AddCommand(newVMCommand())
	root.AddCommand(newContainerCommand())
	root.AddCommand(newDoctorCommand())
	root.AddCommand(newAutostartCommand())
	return root
}

func loadCLIConfig() (*config.Config, error) {
	cfg, err := config.LoadConfig()
	if err != nil {
		return cfg, fmt.Errorf("加载配置失败: %w", err)
	}
	return cfg, nil
}

// resolveProjectRoot mirrors the historical main() behavior: templates must
// be found relative to the real executable (or repository) regardless of the
// current working directory.
func resolveProjectRoot() string {
	exePath, err := os.Executable()
	if err != nil {
		cwd, _ := os.Getwd()
		return cwd
	}
	return detectProjectRoot(exePath)
}

func detectProjectRoot(exePath string) string {
	candidates := make([]string, 0, 2)
	if exePath != "" {
		if resolved, err := filepath.EvalSymlinks(exePath); err == nil {
			candidates = append(candidates, resolved)
		}
		candidates = append(candidates, exePath)
	}
	for _, candidate := range candidates {
		dir := filepath.Dir(candidate)
		roots := []string{dir, filepath.Dir(dir), filepath.Join(filepath.Dir(dir), "Resources")}
		for _, root := range roots {
			if info, err := os.Stat(filepath.Join(root, "templates")); err == nil && info.IsDir() {
				return root
			}
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "."
}

func effectivePort(cfg *config.Config) int {
	if serverOpts.port > 0 {
		return serverOpts.port
	}
	if cfg.Port > 0 {
		return cfg.Port
	}
	return 19808
}

func healthCheck(port int) bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/auth/status", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func waitForHealthy(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if healthCheck(port) {
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return healthCheck(port)
}
