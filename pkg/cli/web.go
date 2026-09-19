package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/system"
	"github.com/spf13/cobra"
)

func newWebCommand() *cobra.Command {
	webCmd := &cobra.Command{
		Use:   "web",
		Short: "控制 MacBox Web 服务进程（launchd 已安装时优先走 launchd）",
	}

	var (
		portFlag int
		hostFlag string
		lanFlag  bool
		noWait   bool
	)
	start := &cobra.Command{
		Use:   "start",
		Short: "启动 Web 服务（默认后台运行）",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			port := portFlag
			if port <= 0 {
				port = effectivePort(cfg)
			}
			if label, loaded := webLaunchAgentLoaded(); loaded {
				if err := launchctlKickstart(label); err != nil {
					return err
				}
				fmt.Printf("已通过 launchd 重启 %s\n", label)
			} else {
				if err := startBackgroundServer(port, hostFlag, lanFlag); err != nil {
					return err
				}
				fmt.Printf("MacBox Web 服务已在后台启动 (pid 文件: %s)\n", pidFilePath())
			}
			if noWait {
				return nil
			}
			if waitForHealthy(port, 15*time.Second) {
				fmt.Printf("✅ 服务健康检查通过: http://127.0.0.1:%d\n", port)
				return nil
			}
			return fmt.Errorf("服务在 15s 内未通过健康检查，请查看 ~/.macbox/macbox.log")
		},
	}
	start.Flags().IntVar(&portFlag, "port", 0, "端口（默认取配置文件）")
	start.Flags().StringVar(&hostFlag, "host", "", "监听地址")
	start.Flags().BoolVar(&lanFlag, "lan", false, "监听 0.0.0.0")
	start.Flags().BoolVar(&noWait, "no-wait", false, "不等待健康检查")

	stop := &cobra.Command{
		Use:   "stop",
		Short: "停止 Web 服务",
		RunE: func(cmd *cobra.Command, args []string) error {
			label, loaded := webLaunchAgentLoaded()
			stoppedAgent := false
			if loaded {
				if err := launchctlKillTERM(label); err != nil {
					return err
				}
				stoppedAgent = true
				fmt.Printf("已向 %s 发送停止信号（KeepAlive 可能会重新拉起，如需彻底停止请先卸载自启）\n", label)
			}
			stopped, err := stopBackgroundServer(8 * time.Second)
			if err != nil {
				return err
			}
			if stopped {
				fmt.Println("后台进程已停止")
			}
			if !stoppedAgent && !stopped {
				return fmt.Errorf("未发现运行中的 MacBox Web 服务（launchd 未加载且无 pid 文件）")
			}
			return nil
		},
	}

	restart := &cobra.Command{
		Use:   "restart",
		Short: "重启 Web 服务",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			port := portFlag
			if port <= 0 {
				port = effectivePort(cfg)
			}
			if label, loaded := webLaunchAgentLoaded(); loaded {
				if err := launchctlKickstart(label); err != nil {
					return err
				}
				fmt.Printf("已通过 launchd 重启 %s\n", label)
			} else {
				if _, err := stopBackgroundServer(8 * time.Second); err != nil {
					return err
				}
				if err := startBackgroundServer(port, "", false); err != nil {
					return err
				}
			}
			if waitForHealthy(port, 15*time.Second) {
				fmt.Printf("✅ 服务健康检查通过: http://127.0.0.1:%d\n", port)
				return nil
			}
			return fmt.Errorf("重启后 15s 内未通过健康检查，请查看 ~/.macbox/macbox.log")
		},
	}
	restart.Flags().IntVar(&portFlag, "port", 0, "端口（默认取配置文件）")

	status := &cobra.Command{
		Use:   "status",
		Short: "查看 Web 服务状态",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			port := effectivePort(cfg)
			running := healthCheck(port)
			label, loaded := webLaunchAgentLoaded()
			pid := readPIDFile()
			fmt.Printf("Web 服务状态:\n")
			fmt.Printf("  健康检查:   %v (http://127.0.0.1:%d)\n", running, port)
			fmt.Printf("  LaunchAgent: %s 已加载=%v\n", label, loaded)
			fmt.Printf("  后台 PID:    %s\n", pidDisplay(pid))
			fmt.Printf("  监听配置:    %s:%d\n", config.NormalizeListenAddress(cfg.ListenAddress), port)
			if !running {
				os.Exit(3)
			}
			return nil
		},
	}

	open := &cobra.Command{
		Use:   "open",
		Short: "用默认浏览器打开 MacBox Web 控制台",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			port := effectivePort(cfg)
			url := fmt.Sprintf("http://127.0.0.1:%d", port)
			if !healthCheck(port) {
				fmt.Printf("⚠️ %s 未响应健康检查，可先执行 macbox web start\n", url)
			}
			return exec.Command("open", url).Run()
		},
	}

	var (
		logsTail   int
		logsFollow bool
	)
	logs := &cobra.Command{
		Use:   "logs",
		Short: "查看后台服务日志 (~/.macbox/macbox.log)",
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := config.ConfigDir()
			if err != nil {
				return err
			}
			logPath := filepath.Join(dir, "macbox.log")
			if _, err := os.Stat(logPath); err != nil {
				return fmt.Errorf("无法读取日志文件: %w", err)
			}
			tailArgs := []string{"-n", strconv.Itoa(logsTail), logPath}
			if logsFollow {
				tailArgs = append([]string{"-f"}, tailArgs...)
			}
			tailCmd := exec.Command("tail", tailArgs...)
			tailCmd.Stdout = os.Stdout
			tailCmd.Stderr = os.Stderr
			return tailCmd.Run()
		},
	}
	logs.Flags().IntVar(&logsTail, "tail", 100, "显示末尾多少行日志")
	logs.Flags().BoolVarP(&logsFollow, "follow", "f", false, "持续跟踪输出（Ctrl-C 退出）")

	webCmd.AddCommand(start, stop, restart, status, open, logs)
	return webCmd
}

// --- launchd helpers -------------------------------------------------------

func guiDomainTarget(label string) string {
	return fmt.Sprintf("gui/%d/%s", os.Getuid(), label)
}

// webLaunchAgentLoaded returns the active web LaunchAgent label and whether
// launchd currently has it loaded. The legacy com.macbox.server label is
// checked as well until the split installer migrates old plists away.
func webLaunchAgentLoaded() (string, bool) {
	for _, label := range []string{system.ServiceLabelWeb, system.ServiceLabel} {
		cmd := exec.Command("launchctl", "print", guiDomainTarget(label))
		if cmd.Run() == nil {
			return label, true
		}
	}
	return system.ServiceLabelWeb, false
}

func launchctlKickstart(label string) error {
	out, err := exec.Command("launchctl", "kickstart", "-k", guiDomainTarget(label)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl kickstart 失败: %s (%w)", strings.TrimSpace(string(out)), err)
	}
	return nil
}

func launchctlKillTERM(label string) error {
	out, err := exec.Command("launchctl", "kill", "SIGTERM", guiDomainTarget(label)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl kill 失败: %s (%w)", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// --- background process helpers -------------------------------------------

func pidFilePath() string {
	dir, err := config.ConfigDir()
	if err != nil {
		return filepath.Join(".macbox", "server.pid")
	}
	return filepath.Join(dir, "server.pid")
}

func readPIDFile() int {
	data, err := os.ReadFile(pidFilePath())
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return 0
	}
	if proc, err := os.FindProcess(pid); err != nil || proc.Signal(syscall.Signal(0)) != nil {
		_ = os.Remove(pidFilePath())
		return 0
	}
	return pid
}

func pidDisplay(pid int) string {
	if pid <= 0 {
		return "无"
	}
	return strconv.Itoa(pid)
}

func startBackgroundServer(port int, host string, lan bool) error {
	if pid := readPIDFile(); pid > 0 {
		return fmt.Errorf("后台已有 MacBox 进程运行 (pid %d)，请先执行 macbox web stop", pid)
	}
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("无法定位 macbox 可执行文件: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	logDir, err := config.ConfigDir()
	if err != nil {
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(logDir, "macbox.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("无法打开服务日志: %w", err)
	}

	args := []string{"--port", strconv.Itoa(port)}
	if lan {
		args = append(args, "--lan")
	} else if host != "" {
		args = append(args, "--host", host)
	}

	cmd := exec.Command(exe, args...)
	cmd.Dir = resolveProjectRoot()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return fmt.Errorf("后台启动失败: %w", err)
	}
	_ = logFile.Close()

	pidPath := pidFilePath()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(cmd.Process.Pid)), 0600); err != nil {
		return fmt.Errorf("启动成功但写入 pid 文件失败: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func stopBackgroundServer(timeout time.Duration) (bool, error) {
	pid := readPIDFile()
	if pid <= 0 {
		return false, nil
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		_ = os.Remove(pidFilePath())
		return false, nil
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		_ = os.Remove(pidFilePath())
		return false, nil
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if proc.Signal(syscall.Signal(0)) != nil {
			_ = os.Remove(pidFilePath())
			return true, nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	_ = proc.Signal(syscall.SIGKILL)
	_ = os.Remove(pidFilePath())
	return true, nil
}
