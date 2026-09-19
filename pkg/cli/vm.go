package cli

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/vm"
	"github.com/spf13/cobra"
)

func newVMCommand() *cobra.Command {
	vmCmd := &cobra.Command{
		Use:   "vm",
		Short: "控制 MacBox 的 Lima 虚拟机（直接调用 limactl，无需 Web 服务在线）",
	}

	requireLima := func() error {
		if _, ok := vm.FindLima(); !ok {
			return fmt.Errorf("未检测到 limactl，请先安装（brew install lima）或在 Web 端完成初始化")
		}
		vm.PrepareLimaEnvironment()
		return nil
	}

	start := &cobra.Command{
		Use:   "start",
		Short: "启动虚拟机并输出进度",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireLima(); err != nil {
				return err
			}
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			mgr := vm.NewManager(cfg)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()
			report := func(stage string, progress int, message string) {
				fmt.Printf("[%s] %3d%% %s\n", stage, progress, message)
			}
			if err := mgr.StartWithProgress(ctx, resolveProjectRoot(), report); err != nil {
				return fmt.Errorf("启动虚拟机失败: %w", err)
			}
			fmt.Printf("✅ 虚拟机 %s 已启动\n", cfg.VM.Name)
			return nil
		},
	}

	stop := &cobra.Command{
		Use:   "stop",
		Short: "停止虚拟机",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireLima(); err != nil {
				return err
			}
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			mgr := vm.NewManager(cfg)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			if err := mgr.Stop(ctx); err != nil {
				return fmt.Errorf("停止虚拟机失败: %w", err)
			}
			fmt.Printf("✅ 虚拟机 %s 已停止\n", cfg.VM.Name)
			return nil
		},
	}

	status := &cobra.Command{
		Use:   "status",
		Short: "查看虚拟机状态",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadCLIConfig()
			if err != nil {
				return err
			}
			if _, ok := vm.FindLima(); !ok {
				fmt.Printf("虚拟机 %s: 未安装 Lima（brew install lima）\n", cfg.VM.Name)
				os.Exit(3)
				return nil
			}
			vm.PrepareLimaEnvironment()
			mgr := vm.NewManager(cfg)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			status, err := mgr.GetStatusContext(ctx)
			if err != nil {
				return fmt.Errorf("获取虚拟机状态失败: %w", err)
			}
			fmt.Printf("虚拟机 %s 状态:\n", cfg.VM.Name)
			fmt.Printf("  状态:       %s\n", status.Status)
			fmt.Printf("  CPU/内存:   %d 核 / %d MiB\n", status.CPUs, status.Memory)
			if status.SSHLocalPort > 0 {
				fmt.Printf("  SSH 端口:   %d\n", status.SSHLocalPort)
			}
			fmt.Printf("  Docker:     ready=%v", status.DockerReady)
			if status.DockerSocket != "" {
				fmt.Printf(" (socket: %s)", status.DockerSocket)
			}
			fmt.Println()
			for _, e := range status.Errors {
				fmt.Printf("  错误:       %s\n", e)
			}
			if status.Status != "Running" {
				os.Exit(3)
			}
			return nil
		},
	}

	list := &cobra.Command{
		Use:   "list",
		Short: "列出所有 Lima 实例（limactl list）",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireLima(); err != nil {
				return err
			}
			path, _ := vm.FindLima()
			listCmd := exec.Command(path, "list")
			listCmd.Stdout = os.Stdout
			listCmd.Stderr = os.Stderr
			return listCmd.Run()
		},
	}

	vmCmd.AddCommand(start, stop, status, list)
	return vmCmd
}
