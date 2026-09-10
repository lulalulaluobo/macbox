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
	PreventSleep   bool     `json:"preventSleep"`   // Configured setting
	Active         bool     `json:"active"`         // Currently running caffeinate process
	Assertions     []string `json:"assertions"`     // Active macOS power assertions
	DisplayCanOff  bool     `json:"displayCanOff"`  // Screen allowed to turn off for energy saving
	Description    string   `json:"description"`    // Human-friendly description
}

type PowerManager struct {
	cfg *config.Config
	mu  sync.Mutex
	cmd *exec.Cmd
}

var globalPowerMgr *PowerManager
var powerOnce sync.Once

func GetPowerManager(cfg *config.Config) *PowerManager {
	powerOnce.Do(func() {
		globalPowerMgr = &PowerManager{cfg: cfg}
		if cfg.System.PreventSleep {
			if err := globalPowerMgr.Start(); err != nil {
				log.Printf("[MacNAS Power] Warning: failed to start caffeinate: %v", err)
			}
		}
	})
	return globalPowerMgr
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
	pm.cfg.System.PreventSleep = enable
	_ = config.SaveConfig(pm.cfg)

	if enable {
		return pm.Start()
	}
	return pm.Stop()
}

// GetStatus checks active assertions and returns full power status
func (pm *PowerManager) GetStatus() PowerStatus {
	assertions := queryPowerAssertions()
	active := pm.IsActive()

	desc := "未开启防休眠守护，系统可能在长时间闲置时进入睡眠"
	if active {
		desc = "防休眠守护运行中（阻止系统睡眠与磁盘休眠，允许显示器黑屏节能）"
	}

	return PowerStatus{
		PreventSleep:  pm.cfg.System.PreventSleep,
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
