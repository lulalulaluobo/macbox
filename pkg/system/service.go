package system

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/luluen/mac-nas/pkg/config"
)

const ServiceLabel = "com.macnas.server"

type ServiceStatus struct {
	Installed  bool   `json:"installed"`
	Running    bool   `json:"running"`
	Label      string `json:"label"`
	PlistPath  string `json:"plistPath"`
	LogPath    string `json:"logPath"`
	BinaryPath string `json:"binaryPath"`
	WorkingDir string `json:"workingDir"`
}

type ServiceManager struct {
	cfg         *config.Config
	projectRoot string
}

func NewServiceManager(cfg *config.Config, projectRoot string) *ServiceManager {
	return &ServiceManager{
		cfg:         cfg,
		projectRoot: projectRoot,
	}
}

func (sm *ServiceManager) PlistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", ServiceLabel+".plist"), nil
}

func (sm *ServiceManager) ResolveBinaryPath() (string, error) {
	// First check if bin/macnas exists in projectRoot
	candidate := filepath.Join(sm.projectRoot, "bin", "macnas")
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		return candidate, nil
	}

	// Fallback to os.Executable
	exe, err := os.Executable()
	if err == nil && !strings.Contains(exe, "go-build") {
		return exe, nil
	}

	return candidate, nil
}

func (sm *ServiceManager) GetStatus() ServiceStatus {
	plistPath, _ := sm.PlistPath()
	binPath, _ := sm.ResolveBinaryPath()
	home, _ := os.UserHomeDir()
	logPath := filepath.Join(home, ".macnas", "macnas.log")

	installed := false
	if plistPath != "" {
		if _, err := os.Stat(plistPath); err == nil {
			installed = true
		}
	}

	running := sm.checkRunning()

	return ServiceStatus{
		Installed:  installed,
		Running:    running,
		Label:      ServiceLabel,
		PlistPath:  plistPath,
		LogPath:    logPath,
		BinaryPath: binPath,
		WorkingDir: sm.projectRoot,
	}
}

func (sm *ServiceManager) checkRunning() bool {
	cmd := exec.Command("launchctl", "list")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(output), ServiceLabel)
}

const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{{.Label}}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{.BinaryPath}}</string>
        <string>-port</string>
        <string>{{.Port}}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{.LogPath}}</string>
    <key>StandardErrorPath</key>
    <string>{{.ErrLogPath}}</string>
    <key>WorkingDirectory</key>
    <string>{{.WorkingDir}}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
`

func (sm *ServiceManager) Install(port int) error {
	plistPath, err := sm.PlistPath()
	if err != nil {
		return fmt.Errorf("failed to get plist path: %w", err)
	}

	// Ensure LaunchAgents directory exists
	if err := os.MkdirAll(filepath.Dir(plistPath), 0755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents dir: %w", err)
	}

	binPath, err := sm.ResolveBinaryPath()
	if err != nil {
		return err
	}

	// Ensure ~/.macnas directory exists for logs
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	macnasDir := filepath.Join(home, ".macnas")
	_ = os.MkdirAll(macnasDir, 0755)

	logPath := filepath.Join(macnasDir, "macnas.log")
	errLogPath := filepath.Join(macnasDir, "macnas.err.log")

	tmpl, err := template.New("plist").Parse(plistTemplate)
	if err != nil {
		return err
	}

	var buf bytes.Buffer
	data := map[string]interface{}{
		"Label":      ServiceLabel,
		"BinaryPath": binPath,
		"Port":       fmt.Sprintf("%d", port),
		"LogPath":    logPath,
		"ErrLogPath": errLogPath,
		"WorkingDir": sm.projectRoot,
	}

	if err := tmpl.Execute(&buf, data); err != nil {
		return err
	}

	// Write plist file
	if err := os.WriteFile(plistPath, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to write plist: %w", err)
	}

	// If already loaded, unload first
	_ = exec.Command("launchctl", "unload", "-w", plistPath).Run()

	// Load service
	cmd := exec.Command("launchctl", "load", "-w", plistPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl load failed: %s (%w)", string(output), err)
	}

	sm.cfg.System.AutoStart = true
	_ = config.SaveConfig(sm.cfg)

	log.Printf("[MacNAS Service] 🚀 LaunchAgent 服务已安装并激活: %s", plistPath)
	return nil
}

func (sm *ServiceManager) Uninstall() error {
	plistPath, err := sm.PlistPath()
	if err != nil {
		return err
	}

	if _, err := os.Stat(plistPath); err == nil {
		cmd := exec.Command("launchctl", "unload", "-w", plistPath)
		_ = cmd.Run()
		_ = os.Remove(plistPath)
	}

	sm.cfg.System.AutoStart = false
	_ = config.SaveConfig(sm.cfg)

	log.Printf("[MacNAS Service] LaunchAgent 服务已卸载")
	return nil
}
