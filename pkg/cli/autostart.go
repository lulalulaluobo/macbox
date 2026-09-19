package cli

import (
	"fmt"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/system"
	"github.com/spf13/cobra"
)

func newAutostartCommand() *cobra.Command {
	var (
		useWeb bool
		useVM  bool
		all    bool
		noOpen bool
	)
	toggle := func(enable bool) func(*cobra.Command, []string) error {
		return func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			if all {
				useWeb, useVM = true, true
			}
			if !useWeb && !useVM {
				return fmt.Errorf("请指定 --web、--vm 或 --all")
			}
			if enable {
				return autostartEnable(cfg, useWeb, useVM, noOpen)
			}
			return autostartDisable(cfg, useWeb, useVM)
		}
	}
	bind := func(c *cobra.Command) {
		c.Flags().BoolVar(&useWeb, "web", false, "作用于 Web 服务自启 (com.macbox.web)")
		c.Flags().BoolVar(&useVM, "vm", false, "作用于虚拟机自启 (com.macbox.vm)")
		c.Flags().BoolVar(&all, "all", false, "同时作用于两个组件")
	}

	enable := &cobra.Command{Use: "enable", Short: "安装开机自启 LaunchAgent", RunE: toggle(true)}
	bind(enable)
	enable.Flags().BoolVar(&noOpen, "no-open", false, "自启时不自动打开网页（并写入配置供菜单栏 App 同步）")

	disable := &cobra.Command{Use: "disable", Short: "卸载开机自启 LaunchAgent", RunE: toggle(false)}
	bind(disable)

	status := &cobra.Command{
		Use:   "status",
		Short: "查看自启安装状态",
		RunE: func(cmd *cobra.Command, args []string) error {
			printAutostartStatus()
			return nil
		},
	}

	noOpenCmd := &cobra.Command{
		Use:       "no-open <on|off>",
		Short:     "开机/启动后是否自动打开网页（on=不打开，off=打开）",
		Args:      cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
		ValidArgs: []string{"on", "off"},
		RunE: func(cmd *cobra.Command, args []string) error {
			noOpen := args[0] == "on"
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			if err := config.Update(cfg, func(updated *config.Config) error {
				updated.System.NoOpen = noOpen
				return nil
			}); err != nil {
				return err
			}
			cfg.System.NoOpen = noOpen
			fmt.Printf("✅ 启动后自动打开网页: %v\n", !noOpen)
			if status := system.AgentStatus(system.ServiceLabelWeb); status.Installed {
				// The flag is baked into the plist at install time, so refresh
				// the agent to match the new preference.
				if err := autostartEnable(cfg, true, false, false); err != nil {
					return err
				}
				fmt.Println("✅ 已同步更新 Web 自启 LaunchAgent")
			}
			return nil
		},
	}

	cmd := &cobra.Command{
		Use:     "autostart",
		Aliases: []string{"service"},
		Short:   "管理 LaunchAgent 开机自启（Web 服务与虚拟机分开控制）",
	}
	cmd.AddCommand(enable, disable, status, noOpenCmd)
	return cmd
}

func autostartEnable(cfg *config.Config, useWeb, useVM, noOpen bool) error {
	serviceMgr := system.NewServiceManager(cfg, resolveProjectRoot())
	if useWeb {
		if noOpen {
			cfg.System.NoOpen = true
		}
		opts := system.InstallOptions{
			Port:   effectivePort(cfg),
			Host:   config.NormalizeListenAddress(cfg.ListenAddress),
			NoOpen: cfg.System.NoOpen || noOpen,
		}
		if err := serviceMgr.InstallComponent(system.ComponentWeb, opts); err != nil {
			return fmt.Errorf("安装 Web 自启失败: %w", err)
		}
		fmt.Println("✅ Web 服务自启 (com.macbox.web) 已安装并启动")
	}
	if useVM {
		if err := serviceMgr.InstallComponent(system.ComponentVM, system.InstallOptions{}); err != nil {
			return fmt.Errorf("安装虚拟机自启失败: %w", err)
		}
		fmt.Println("✅ 虚拟机自启 (com.macbox.vm) 已安装，登录后自动执行 macbox vm start")
	}
	if noOpen {
		if err := config.Update(cfg, func(updated *config.Config) error {
			updated.System.NoOpen = true
			return nil
		}); err != nil {
			return fmt.Errorf("自启已安装，但写入 no-open 配置失败: %w", err)
		}
		fmt.Println("✅ 已记录 --no-open：启动后不自动打开网页")
	}
	return nil
}

func autostartDisable(cfg *config.Config, useWeb, useVM bool) error {
	serviceMgr := system.NewServiceManager(cfg, resolveProjectRoot())
	if useWeb {
		if err := serviceMgr.UninstallComponent(system.ComponentWeb); err != nil {
			return fmt.Errorf("卸载 Web 自启失败: %w", err)
		}
		fmt.Println("✅ Web 服务自启已卸载")
	}
	if useVM {
		if err := serviceMgr.UninstallComponent(system.ComponentVM); err != nil {
			return fmt.Errorf("卸载虚拟机自启失败: %w", err)
		}
		fmt.Println("✅ 虚拟机自启已卸载（运行中的虚拟机不受影响，可用 macbox vm stop 停止）")
	}
	return nil
}

func printAutostartStatus() {
	fmt.Println("LaunchAgent 自启状态:")
	for _, label := range []string{system.ServiceLabelWeb, system.ServiceLabelVM, system.ServiceLabel} {
		s := system.AgentStatus(label)
		state := "未安装"
		if s.Installed {
			state = "已安装 · launchd 未加载"
			if s.Running {
				state = "已安装 · 已加载"
			}
		}
		suffix := ""
		if label == system.ServiceLabel && s.Installed {
			suffix = "  （旧版，执行 macbox autostart enable --all 可迁移）"
		}
		fmt.Printf("  %-16s %s%s\n", label, state, suffix)
	}
	cfg, err := config.LoadConfig()
	if err == nil {
		fmt.Printf("  no-open 配置: %v\n", cfg.System.NoOpen)
	}
}
