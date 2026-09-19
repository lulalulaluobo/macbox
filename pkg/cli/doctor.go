package cli

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/containerengine"
	"github.com/lulalulaluobo/macbox/pkg/vm"
	"github.com/spf13/cobra"
)

type doctorCheck struct {
	Name    string
	OK      bool
	Detail  string
	FixHint string
}

func newDoctorCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "诊断运行环境：Homebrew / Lima / Web 服务 / 容器引擎 / Apple container",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			var checks []doctorCheck
			checks = append(checks, doctorHomebrew(), doctorLima(), doctorVMInstance(ctx, cfg), doctorWebHealth(effectivePort(cfg)))
			checks = append(checks, doctorHostEngines()...)
			checks = append(checks, doctorAppleContainer(ctx))
			checks = append(checks, doctorMocker(cfg))

			allOK := true
			for _, c := range checks {
				mark := "✗"
				if c.OK {
					mark = "✓"
				} else {
					allOK = false
				}
				fmt.Printf("%s %-18s %s\n", mark, c.Name, c.Detail)
				if !c.OK && c.FixHint != "" {
					fmt.Printf("  ↳ 建议: %s\n", c.FixHint)
				}
			}
			if allOK {
				fmt.Println("\n环境检查全部通过。")
			}
			return nil
		},
	}
}

func doctorHomebrew() doctorCheck {
	if brew, ok := vm.FindHomebrew(); ok {
		return doctorCheck{Name: "Homebrew", OK: true, Detail: brew}
	}
	return doctorCheck{Name: "Homebrew", OK: false, Detail: "未检测到 brew", FixHint: "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""}
}

func doctorLima() doctorCheck {
	path, ok := vm.FindLima()
	if !ok {
		return doctorCheck{Name: "Lima", OK: false, Detail: "未检测到 limactl", FixHint: "brew install lima"}
	}
	version := strings.TrimSpace(runOutput(path, "version"))
	return doctorCheck{Name: "Lima", OK: true, Detail: fmt.Sprintf("%s (%s)", path, firstLine(version))}
}

func doctorVMInstance(ctx context.Context, cfg *config.Config) doctorCheck {
	if _, ok := vm.FindLima(); !ok {
		return doctorCheck{Name: "虚拟机", OK: false, Detail: "Lima 未安装，跳过", FixHint: "先安装 Lima"}
	}
	vm.PrepareLimaEnvironment()
	mgr := vm.NewManager(cfg)
	status, err := mgr.GetStatusContext(ctx)
	if err != nil {
		return doctorCheck{Name: "虚拟机", OK: false, Detail: err.Error()}
	}
	switch status.Status {
	case "Running":
		return doctorCheck{Name: "虚拟机", OK: true, Detail: fmt.Sprintf("%s Running (cpu=%d mem=%dMiB)", status.Name, status.CPUs, status.Memory)}
	case "Stopped":
		return doctorCheck{Name: "虚拟机", OK: false, Detail: fmt.Sprintf("%s Stopped", status.Name), FixHint: "macbox vm start"}
	default:
		return doctorCheck{Name: "虚拟机", OK: false, Detail: fmt.Sprintf("%s %s", status.Name, status.Status), FixHint: "在 Web 端初始化或通过 macbox vm start 创建"}
	}
}

func doctorWebHealth(port int) doctorCheck {
	if healthCheck(port) {
		return doctorCheck{Name: "Web 服务", OK: true, Detail: fmt.Sprintf("http://127.0.0.1:%d 健康", port)}
	}
	return doctorCheck{Name: "Web 服务", OK: false, Detail: fmt.Sprintf("端口 %d 无响应", port), FixHint: "macbox web start"}
}

func doctorHostEngines() []doctorCheck {
	engines := containerengine.HostEngines()
	if len(engines) == 0 {
		return []doctorCheck{{
			Name: "宿主容器引擎", OK: false,
			Detail:  "未检测到 OrbStack / Docker Desktop / docker CLI",
			FixHint: "安装 OrbStack (https://orbstack.dev) 后将自动被 MacBox 复用；否则回退 Lima VM 内置 Docker",
		}}
	}
	checks := make([]doctorCheck, 0, len(engines))
	for _, e := range engines {
		detail := "已安装"
		if e.Running {
			detail = fmt.Sprintf("运行中 · socket=%s", e.SocketPath)
		}
		checks = append(checks, doctorCheck{Name: "宿主容器引擎", OK: e.Running, Detail: fmt.Sprintf("%s: %s", e.Name, detail)})
	}
	return checks
}

func doctorAppleContainer(ctx context.Context) doctorCheck {
	path, ok := containerengine.AppleContainerCLI()
	if !ok {
		return doctorCheck{Name: "Apple container", OK: false, Detail: "未检测到 container CLI（需要 macOS 26+）"}
	}
	out, err := runOutputErr(ctx, path, "system", "status")
	detail := firstLine(strings.TrimSpace(out))
	if err != nil {
		return doctorCheck{Name: "Apple container", OK: false, Detail: fmt.Sprintf("%s · 服务未运行 (%s)", path, detail), FixHint: "sudo container system start"}
	}
	return doctorCheck{Name: "Apple container", OK: true, Detail: fmt.Sprintf("%s · %s", path, detail)}
}

func doctorMocker(cfg *config.Config) doctorCheck {
	path, installed := containerengine.MockerCLI()
	switch {
	case !cfg.Container.AppleCompose:
		return doctorCheck{Name: "mocker 兼容层", OK: true, Detail: "未开启（实验性功能，可选）"}
	case installed:
		return doctorCheck{Name: "mocker 兼容层", OK: true, Detail: "已开启 · " + path}
	default:
		return doctorCheck{Name: "mocker 兼容层", OK: false, Detail: "已开启但未检测到 mocker CLI", FixHint: "brew tap us/tap && brew install mocker"}
	}
}

func runOutput(name string, args ...string) string {
	out, _ := exec.Command(name, args...).CombinedOutput()
	return string(out)
}

func runOutputErr(ctx context.Context, name string, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return string(out), err
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		return s[:idx]
	}
	return s
}
