package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/containerengine"
	"github.com/lulalulaluobo/macbox/pkg/system"
	"github.com/lulalulaluobo/macbox/pkg/vm"
	"github.com/spf13/cobra"
)

func newStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "汇总 Web 服务、自启项、虚拟机与容器引擎的当前状态",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			port := effectivePort(cfg)

			fmt.Println("MacBox 状态总览")
			fmt.Println("──────────────────────────────────────────────")

			// Web 服务
			pid := readPIDFile()
			healthy := healthCheck(port)
			webAgent := system.AgentStatus(system.ServiceLabelWeb)
			legacyAgent := system.AgentStatus(system.ServiceLabel)
			fmt.Printf("Web 服务      运行=%v (端口 %d)\n", healthy, port)
			if pid > 0 {
				fmt.Printf("              后台进程 pid=%d\n", pid)
			}
			if !webAgent.Installed && legacyAgent.Installed {
				fmt.Printf("              自启: 旧版 %s（建议 macbox autostart enable --web 迁移）\n", system.ServiceLabel)
			}

			// 自启 LaunchAgents
			printAgent := func(title string, s system.ServiceStatus) {
				state := "未安装"
				if s.Installed {
					state = "已安装"
					if s.Running {
						state = "已安装 · 已加载"
					}
				}
				fmt.Printf("%-12s%s\n", title, state)
			}
			printAgent("自启/Web", webAgent)
			printAgent("自启/VM", system.AgentStatus(system.ServiceLabelVM))

			// 虚拟机
			if _, ok := vm.FindLima(); !ok {
				fmt.Println("虚拟机        未安装 Lima（brew install lima）")
			} else {
				vm.PrepareLimaEnvironment()
				mgr := vm.NewManager(cfg)
				ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				status, statusErr := mgr.GetStatusContext(ctx)
				cancel()
				if statusErr != nil {
					fmt.Printf("虚拟机        状态获取失败: %v\n", statusErr)
				} else {
					fmt.Printf("虚拟机        %s: %s\n", status.Name, status.Status)
					if status.DockerSocket != "" {
						fmt.Printf("              VM Docker socket: %s (ready=%v)\n", status.DockerSocket, status.DockerReady)
					}
				}
			}

			// 容器引擎
			hostEngines := containerengine.HostEngines()
			if len(hostEngines) == 0 {
				fmt.Println("容器引擎      宿主未检测到 OrbStack/Docker Desktop/docker CLI")
			}
			for _, e := range hostEngines {
				state := "未运行"
				if e.Running {
					state = fmt.Sprintf("运行中 (%s)", e.SocketPath)
				}
				fmt.Printf("容器引擎      %s: %s\n", e.Name, state)
			}
			applePath, appleOK := containerengine.AppleContainerCLI()
			appleEnabled := appleOK && cfg.Container.Mode != "docker" && cfg.VM.DockerMode != "vm"
			if engine, ok := containerengine.PreferredDocker(cfg.VM.Name); ok {
				fmt.Printf("当前选用引擎  %s\n", engine.Name)
			} else if appleEnabled {
				fmt.Println("当前选用引擎  Apple container（无 Docker 引擎，自动回退）")
			} else {
				fmt.Println("当前选用引擎  无可用 Docker 守护进程")
			}
			if appleOK {
				note := ""
				switch cfg.Container.Mode {
				case "docker":
					note = "（container.mode=docker，未启用）"
				case "apple":
					note = "（container.mode=apple，强制使用）"
				}
				fmt.Printf("Apple container 已安装 %s%s\n", applePath, note)
				if appleEnabled {
					mockerPath, mockerOK := containerengine.MockerCLI()
					switch {
					case !cfg.Container.AppleCompose:
						fmt.Println("mocker Compose 兼容层  未开启（实验性，macbox container compose enable）")
					case mockerOK:
						fmt.Printf("mocker Compose 兼容层  已开启 (%s)\n", mockerPath)
					default:
						fmt.Println("mocker Compose 兼容层  已开启，但未检测到 mocker（brew tap us/tap && brew install mocker）")
					}
				}
			}

			// 电源
			fmt.Printf("防休眠        配置=%v\n", cfg.System.PreventSleep)
			return nil
		},
	}
}
