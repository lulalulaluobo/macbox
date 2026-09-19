package cli

import (
	"context"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/containerapple"
	"github.com/lulalulaluobo/macbox/pkg/containerengine"
	"github.com/spf13/cobra"
)

func newContainerCommand() *cobra.Command {
	root := &cobra.Command{
		Use:   "container",
		Short: "通过 Apple container CLI 管理 macOS 原生容器（Compose 依赖实验性 mocker 兼容层）",
	}
	root.AddCommand(
		containerListCmd(),
		containerActionCmd("start", "启动容器"),
		containerActionCmd("stop", "停止容器"),
		containerActionCmd("rm", "删除容器"),
		containerLogsCmd(),
		containerSystemCmd(),
		containerComposeCmd(),
		containerModeCmd(),
	)
	return root
}

// containerModeCmd shows or sets container.mode, which engine the Docker
// handler family should prefer (auto falls back to Apple only when no Docker
// engine answers).
func containerModeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "mode [auto|apple|docker]",
		Short: "查看或设置容器引擎偏好（不改动 Docker 引擎选择 dockerMode）",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			if len(args) == 0 {
				fmt.Printf("container.mode: %s\n", cfg.Container.Mode)
				return nil
			}
			mode := args[0]
			switch mode {
			case "auto", "apple", "docker":
			default:
				return fmt.Errorf("无效的 mode %q（可选 auto|apple|docker）", mode)
			}
			if err := config.Update(cfg, func(updated *config.Config) error {
				updated.Container.Mode = mode
				return nil
			}); err != nil {
				return err
			}
			fmt.Printf("✅ container.mode 已设置为 %s\n", mode)
			if healthCheck(effectivePort(cfg)) {
				fmt.Println("⚠️ 运行中的 Web 服务读的是启动时的配置，请执行 macbox web restart 后生效")
			}
			return nil
		},
	}
}

// containerComposeCmd manages the experimental mocker bridge that gives the
// Apple container engine docker-compatible Compose support.
func containerComposeCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "compose",
		Short: "实验性 mocker Compose 兼容层（Apple 引擎下提供 docker compose 能力）",
	}
	report := func() error {
		cfg, err := config.LoadConfig()
		if err != nil {
			return err
		}
		cliPath, installed := containerengine.MockerCLI()
		fmt.Printf("兼容层开关: %v\n", cfg.Container.AppleCompose)
		fmt.Printf("container.mode: %s\n", cfg.Container.Mode)
		if installed {
			fmt.Printf("mocker CLI: %s\n", cliPath)
		} else {
			fmt.Println("mocker CLI: 未安装（brew tap us/tap && brew install mocker）")
		}
		return nil
	}
	set := func(enabled bool) func(*cobra.Command, []string) error {
		return func(cmd *cobra.Command, args []string) error {
			cfg, err := config.LoadConfig()
			if err != nil {
				return err
			}
			if err := config.Update(cfg, func(updated *config.Config) error {
				updated.Container.AppleCompose = enabled
				return nil
			}); err != nil {
				return err
			}
			if !enabled {
				fmt.Println("✅ mocker Compose 兼容层已关闭")
			} else if _, installed := containerengine.MockerCLI(); !installed {
				fmt.Println("⚠️ 已开启兼容层，但未检测到 mocker CLI，请执行: brew tap us/tap && brew install mocker")
			} else {
				fmt.Println("✅ mocker Compose 兼容层已开启")
			}
			if enabled && healthCheck(effectivePort(cfg)) {
				fmt.Println("⚠️ 运行中的 Web 服务读的是启动时的配置，请执行 macbox web restart 后生效")
			}
			return nil
		}
	}
	root.AddCommand(
		&cobra.Command{Use: "status", Short: "查看开关与 mocker 安装状态", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error { return report() }},
		&cobra.Command{Use: "enable", Short: "开启兼容层（需已安装 mocker）", Args: cobra.NoArgs, RunE: set(true)},
		&cobra.Command{Use: "disable", Short: "关闭兼容层", Args: cobra.NoArgs, RunE: set(false)},
	)
	return root
}

func newAppleClient() (*containerapple.Client, error) {
	client, ok := containerapple.NewClient()
	if !ok {
		return nil, fmt.Errorf("未找到 container CLI（需要 macOS 26+，安装 Apple 的 container 工具）")
	}
	return client, nil
}

func containerListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Aliases: []string{"ls"},
		Short:   "列出全部容器（含已停止）",
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := newAppleClient()
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			containers, err := client.List(ctx)
			if err != nil {
				return err
			}
			w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(w, "容器\t状态\t镜像\t项目")
			for _, c := range containers {
				project := c.Project()
				if project == "" {
					project = "-"
				}
				image := c.ImageRef()
				if image == "" {
					image = "<none>"
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", c.Name(), c.State(), image, project)
			}
			return w.Flush()
		},
	}
}

func containerActionCmd(action, short string) *cobra.Command {
	var force bool
	cmd := &cobra.Command{
		Use:   action + " <容器ID>",
		Short: short,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := newAppleClient()
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			id := args[0]
			switch action {
			case "start":
				err = client.Start(ctx, id)
			case "stop":
				err = client.Stop(ctx, id, 10*time.Second)
			case "rm":
				err = client.Delete(ctx, id, force)
			}
			if err != nil {
				return err
			}
			fmt.Printf("容器 %s %s完成\n", id, action)
			return nil
		},
	}
	if action == "rm" {
		cmd.Flags().BoolVarP(&force, "force", "f", false, "容器仍在运行时强制删除")
	}
	return cmd
}

func containerLogsCmd() *cobra.Command {
	var tail int
	cmd := &cobra.Command{
		Use:   "logs <容器ID>",
		Short: "输出容器日志",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := newAppleClient()
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			out, err := client.LogsStream(ctx, args[0], tail)
			if err != nil {
				return err
			}
			os.Stdout.Write(out)
			return nil
		},
	}
	cmd.Flags().IntVar(&tail, "tail", 100, "显示末尾多少行日志")
	return cmd
}

func containerSystemCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "system",
		Short: "container 服务（user daemons）状态与启停",
	}
	for _, action := range []string{"status", "start", "stop"} {
		action := action
		root.AddCommand(&cobra.Command{
			Use:   action,
			Short: "container system " + action,
			RunE: func(cmd *cobra.Command, args []string) error {
				client, err := newAppleClient()
				if err != nil {
					return err
				}
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				defer cancel()
				switch action {
				case "status":
					running, detail, err := client.SystemStatus(ctx)
					if err != nil {
						return err
					}
					fmt.Printf("Apple container 服务: running=%v (%s)\n", running, detail)
					return nil
				case "start":
					if err := client.SystemStart(ctx); err != nil {
						return err
					}
					fmt.Println("Apple container 服务已启动")
					return nil
				case "stop":
					if err := client.SystemStop(ctx); err != nil {
						return err
					}
					fmt.Println("Apple container 服务已停止")
					return nil
				}
				return nil
			},
		})
	}
	return root
}
