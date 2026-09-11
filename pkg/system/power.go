package system

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"

	"github.com/luluen/mac-nas/pkg/config"
)

type PowerStatus struct {
	PreventSleep  bool     `json:"preventSleep"`  // Configured setting
	Active        bool     `json:"active"`        // Currently running caffeinate process
	Assertions    []string `json:"assertions"`    // Active macOS power assertions
	DisplayCanOff bool     `json:"displayCanOff"` // Screen allowed to turn off for energy saving
	Description   string   `json:"description"`   // Human-friendly description
}

type PowerManager struct {
	cfg *config.Config
	mu  sync.Mutex
	cmd *exec.Cmd
}

func GetPowerManager(cfg *config.Config) *PowerManager {
	// Construction is deliberately side-effect free. The process owner must
	// explicitly call Start and Stop so tests and embedded callers cannot leak a
	// caffeinate process or share mutable global state.
	return &PowerManager{cfg: cfg}
}

// Start launches caffeinate with -s (AC sleep), -i (idle sleep), -m (disk sleep)
func (pm *PowerManager) Start() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.cmd != nil && pm.cmd.Process != nil {
		// Already running
		return nil
	}

	cmd := exec.Command("caffeinate", "-s", "-i", "-m")
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start caffeinate: %w", err)
	}

	pm.cmd = cmd
	log.Printf("[MacNAS Power] ☕ 24h 防休眠守护已激活 (PID: %d, caffeinate -s -i -m)", cmd.Process.Pid)

	// Clean up if process exits unexpectedly
	go func() {
		_ = cmd.Wait()
		pm.mu.Lock()
		if pm.cmd == cmd {
			pm.cmd = nil
		}
		pm.mu.Unlock()
	}()

	return nil
}

// Stop terminates the caffeinate process cleanly
func (pm *PowerManager) Stop() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.cmd != nil && pm.cmd.Process != nil {
		pid := pm.cmd.Process.Pid
		_ = pm.cmd.Process.Kill()
		pm.cmd = nil
		log.Printf("[MacNAS Power] ☕ 24h 防休眠守护已停止 (原 PID: %d)", pid)
	}
	return nil
}

// IsActive returns whether caffeinate is currently actively running
func (pm *PowerManager) IsActive() bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return pm.cmd != nil && pm.cmd.Process != nil
}

// SetPreventSleep updates configuration and applies change
func (pm *PowerManager) SetPreventSleep(enable bool) error {
	cfgSnapshot, err := config.Snapshot(pm.cfg)
	if err != nil {
		return fmt.Errorf("读取防休眠配置失败: %w", err)
	}
	previous := cfgSnapshot.System.PreventSleep
	if enable {
		if err := pm.Start(); err != nil {
			return err
		}
	} else if err := pm.Stop(); err != nil {
		return err
	}

	if err := config.Update(pm.cfg, func(updated *config.Config) error {
		updated.System.PreventSleep = enable
		return nil
	}); err != nil {
		if previous {
			if restoreErr := pm.Start(); restoreErr != nil {
				log.Printf("[MacNAS Power] 回滚防休眠进程失败: %v", restoreErr)
			}
		} else {
			if restoreErr := pm.Stop(); restoreErr != nil {
				log.Printf("[MacNAS Power] 回滚防休眠进程失败: %v", restoreErr)
			}
		}
		return fmt.Errorf("保存防休眠配置失败: %w", err)
	}
	return nil
}

// GetStatus checks active assertions and returns full power status
func (pm *PowerManager) GetStatus() PowerStatus {
	assertions := queryPowerAssertions()
	active := pm.IsActive()
	preventSleep := false
	if cfgSnapshot, err := config.Snapshot(pm.cfg); err == nil {
		preventSleep = cfgSnapshot.System.PreventSleep
	}

	desc := "未开启防休眠守护，系统可能在长时间闲置时进入睡眠"
	if active {
		desc = "防休眠守护运行中（阻止系统睡眠与磁盘休眠，允许显示器黑屏节能）"
	}

	return PowerStatus{
		PreventSleep:  preventSleep,
		Active:        active,
		Assertions:    assertions,
		DisplayCanOff: true,
		Description:   desc,
	}
}

func queryPowerAssertions() []string {
	cmd := exec.Command("pmset", "-g", "assertions")
	output, err := cmd.Output()
	if err != nil {
		return nil
	}

	var results []string
	scanner := bufio.NewScanner(bytes.NewReader(output))
	inSummary := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "Assertion status system-wide:") {
			inSummary = true
			continue
		}
		if strings.HasPrefix(line, "Listed by owning process:") {
			break
		}
		if inSummary && line != "" {
			parts := strings.Fields(line)
			if len(parts) >= 2 && parts[1] != "0" {
				results = append(results, fmt.Sprintf("%s: 启用", parts[0]))
			}
		}
	}
	return results
}
