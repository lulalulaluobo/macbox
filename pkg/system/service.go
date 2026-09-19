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

	"github.com/lulalulaluobo/macbox/pkg/config"
)

const (
	// ServiceLabel is the legacy single-agent label. Installing either
	// component migrates any old plist with this label away.
	ServiceLabel = "com.macbox.server"
	// ServiceLabelWeb autostarts the MacBox web server.
	ServiceLabelWeb = "com.macbox.web"
	// ServiceLabelVM starts the Lima VM at login as a one-shot job.
	ServiceLabelVM = "com.macbox.vm"
)

// Component identifies one of the two independently-managed LaunchAgents.
type Component string

const (
	ComponentWeb Component = "web"
	ComponentVM  Component = "vm"
)

// LabelFor maps a component to its LaunchAgent label.
func LabelFor(comp Component) string {
	switch comp {
	case ComponentWeb:
		return ServiceLabelWeb
	case ComponentVM:
		return ServiceLabelVM
	default:
		return ServiceLabel
	}
}

type ServiceStatus struct {
	Installed  bool   `json:"installed"`
	Running    bool   `json:"running"`
	Label      string `json:"label"`
	PlistPath  string `json:"plistPath"`
	LogPath    string `json:"logPath"`
	BinaryPath string `json:"binaryPath"`
	WorkingDir string `json:"workingDir"`
}

type InstallOptions struct {
	Port   int
	Host   string
	NoOpen bool
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
	return sm.PlistPathFor(ComponentWeb)
}

func (sm *ServiceManager) PlistPathFor(comp Component) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", LabelFor(comp)+".plist"), nil
}

func (sm *ServiceManager) ResolveBinaryPath() (string, error) {
	// First check if bin/macbox exists in projectRoot
	candidate := filepath.Join(sm.projectRoot, "bin", "macbox")
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
	return sm.StatusComponent(ComponentWeb)
}

// StatusComponent reports one LaunchAgent's plist and load state.
func (sm *ServiceManager) StatusComponent(comp Component) ServiceStatus {
	label := LabelFor(comp)
	plistPath, _ := sm.PlistPathFor(comp)
	binPath, _ := sm.ResolveBinaryPath()
	home, _ := os.UserHomeDir()
	logName := "macbox.log"
	if comp == ComponentVM {
		logName = "vm-autostart.log"
	}
	logPath := filepath.Join(home, ".macbox", logName)

	installed := false
	if plistPath != "" {
		if _, err := os.Stat(plistPath); err == nil {
			installed = true
		}
	}

	return ServiceStatus{
		Installed:  installed,
		Running:    AgentLoaded(label),
		Label:      label,
		PlistPath:  plistPath,
		LogPath:    logPath,
		BinaryPath: binPath,
		WorkingDir: sm.projectRoot,
	}
}

// AgentStatus reports plist installation and launchd load state for any
// LaunchAgent label in the user GUI domain. The CLI uses it to summarize the
// web/vm split agents plus the legacy one without owning path knowledge.
func AgentStatus(label string) ServiceStatus {
	home, _ := os.UserHomeDir()
	plistPath := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	installed := false
	if _, err := os.Stat(plistPath); err == nil {
		installed = true
	}
	return ServiceStatus{
		Installed: installed,
		Running:   AgentLoaded(label),
		Label:     label,
		PlistPath: plistPath,
	}
}

// AgentLoaded reports whether launchd currently has the label loaded.
func AgentLoaded(label string) bool {
	target := fmt.Sprintf("gui/%d/%s", os.Getuid(), label)
	return exec.Command("launchctl", "print", target).Run() == nil
}

const webPlistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{{.Label}}</string>
    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>io.github.lulalulaluobo.macbox.menu</string>
    </array>
    <key>ProgramArguments</key>
    <array>
        <string>{{.BinaryPath}}</string>
        <string>--port</string>
        <string>{{.Port}}</string>
        <string>--host</string>
        <string>{{.Host}}</string>
{{- if .NoOpen}}
        <string>--no-open</string>
{{- end}}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{.LogPath}}</string>
    <key>StandardErrorPath</key>
    <string>{{.LogPath}}</string>
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

// vmPlistTemplate launches the Lima instance once at login. KeepAlive with
// SuccessfulExit=false retries failed starts while launchd's throttle window
// prevents a hot loop; a successful start exits and is not relaunched until
// the next login.
const vmPlistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{{.Label}}</string>
    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>io.github.lulalulaluobo.macbox.menu</string>
    </array>
    <key>ProgramArguments</key>
    <array>
        <string>{{.BinaryPath}}</string>
        <string>vm</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>{{.LogPath}}</string>
    <key>StandardErrorPath</key>
    <string>{{.LogPath}}</string>
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

// Install keeps the legacy call shape: install the web agent.
func (sm *ServiceManager) Install(port int) error {
	return sm.InstallComponent(ComponentWeb, InstallOptions{
		Port:   port,
		Host:   config.NormalizeListenAddress(sm.cfg.ListenAddress),
		NoOpen: sm.cfg.System.NoOpen,
	})
}

// Uninstall removes the web agent (legacy shape).
func (sm *ServiceManager) Uninstall() error {
	return sm.UninstallComponent(ComponentWeb)
}

func (sm *ServiceManager) InstallComponent(comp Component, opts InstallOptions) error {
	plistPath, err := sm.PlistPathFor(comp)
	if err != nil {
		return fmt.Errorf("failed to get plist path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(plistPath), 0755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents dir: %w", err)
	}
	binPath, err := sm.ResolveBinaryPath()
	if err != nil {
		return err
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	macboxDir := filepath.Join(home, ".macbox")
	if err := os.MkdirAll(macboxDir, 0700); err != nil {
		return fmt.Errorf("failed to create MacBox data dir: %w", err)
	}
	if err := os.Chmod(macboxDir, 0700); err != nil {
		return fmt.Errorf("failed to secure MacBox data dir: %w", err)
	}
	logName := "macbox.log"
	if comp == ComponentVM {
		logName = "vm-autostart.log"
	}
	logPath := filepath.Join(macboxDir, logName)
	// All supported launch paths use one canonical service log. Keeping stdout
	// and stderr together makes the menu-bar "打开日志" action useful no
	// matter whether the service was started by LaunchAgent, the menu helper,
	// or the command-line controller.
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("failed to create service log: %w", err)
	}
	if err := logFile.Close(); err != nil {
		return fmt.Errorf("failed to close service log: %w", err)
	}
	if err := os.Chmod(logPath, 0600); err != nil {
		return fmt.Errorf("failed to secure service log: %w", err)
	}

	data := map[string]interface{}{
		"Label":      LabelFor(comp),
		"BinaryPath": binPath,
		"LogPath":    logPath,
		"WorkingDir": sm.projectRoot,
	}
	tmplText := vmPlistTemplate
	if comp == ComponentWeb {
		port := opts.Port
		if port <= 0 {
			port = sm.cfg.Port
		}
		if port <= 0 {
			port = 19808
		}
		host := opts.Host
		if host == "" {
			host = config.NormalizeListenAddress(sm.cfg.ListenAddress)
		}
		tmplText = webPlistTemplate
		data["Port"] = fmt.Sprintf("%d", port)
		data["Host"] = host
		data["NoOpen"] = opts.NoOpen
	}
	tmpl, err := template.New("plist").Parse(tmplText)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return err
	}
	if err := os.WriteFile(plistPath, buf.Bytes(), 0600); err != nil {
		return fmt.Errorf("failed to write plist: %w", err)
	}

	if err := exec.Command("launchctl", "unload", "-w", plistPath).Run(); err != nil {
		// launchctl returns an error when the label was not loaded yet. The
		// plist is still valid, so continue with load.
		log.Printf("[MacBox Service] existing LaunchAgent unload skipped: %v", err)
	}
	cmd := exec.Command("launchctl", "load", "-w", plistPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl load failed: %s (%w)", string(output), err)
	}

	// Retire the pre-split single agent once the replacement is live.
	if err := sm.migrateLegacyAgent(); err != nil {
		log.Printf("[MacBox Service] 旧版 %s 迁移失败（不影响新服务）: %v", ServiceLabel, err)
	}

	if err := config.Update(sm.cfg, func(updated *config.Config) error {
		switch comp {
		case ComponentWeb:
			updated.System.AutoStartWeb = true
			if opts.NoOpen {
				updated.System.NoOpen = true
			}
		case ComponentVM:
			updated.System.AutoStartVM = true
		default:
			return fmt.Errorf("未知组件 %q", comp)
		}
		return nil
	}); err != nil {
		// Do not leave a running service behind when its durable configuration
		// could not be updated.
		if rollbackErr := exec.Command("launchctl", "unload", "-w", plistPath).Run(); rollbackErr != nil {
			return fmt.Errorf("service loaded but failed to save configuration: %v; rollback failed: %w", err, rollbackErr)
		}
		return fmt.Errorf("service loaded but failed to save configuration: %w", err)
	}

	log.Printf("[MacBox Service] 🚀 LaunchAgent 服务已安装并激活: %s", plistPath)
	return nil
}

func (sm *ServiceManager) UninstallComponent(comp Component) error {
	plistPath, err := sm.PlistPathFor(comp)
	if err != nil {
		return err
	}

	var plistData []byte
	hadPlist := false
	if _, err := os.Stat(plistPath); err == nil {
		plistData, err = os.ReadFile(plistPath)
		if err != nil {
			return fmt.Errorf("failed to read service plist before uninstall: %w", err)
		}
		hadPlist = true
		if err := exec.Command("launchctl", "unload", "-w", plistPath).Run(); err != nil {
			if output, killErr := exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), LabelFor(comp))).CombinedOutput(); killErr != nil {
				return fmt.Errorf("launchctl unload failed: %s (%w)", strings.TrimSpace(string(output)), killErr)
			}
		}
		if err := os.Remove(plistPath); err != nil {
			return fmt.Errorf("failed to remove service plist: %w", err)
		}
	}

	if comp == ComponentVM {
		// Stopping the VM is opt-in via `macbox vm stop`; uninstalling the
		// autostart job must not tear down a running instance.
		if err := config.Update(sm.cfg, func(updated *config.Config) error {
			updated.System.AutoStartVM = false
			return nil
		}); err != nil {
			sm.restorePlist(plistPath, plistData, hadPlist, err)
			return fmt.Errorf("failed to save service configuration: %w", err)
		}
		log.Printf("[MacBox Service] LaunchAgent 服务已卸载: %s", LabelFor(comp))
		return nil
	}

	if err := config.Update(sm.cfg, func(updated *config.Config) error {
		updated.System.AutoStartWeb = false
		return nil
	}); err != nil {
		if hadPlist {
			if restoreErr := os.WriteFile(plistPath, plistData, 0600); restoreErr == nil {
				if loadErr := exec.Command("launchctl", "load", "-w", plistPath).Run(); loadErr != nil {
					return fmt.Errorf("failed to save service configuration: %v; service restore failed: %w", err, loadErr)
				}
			} else {
				return fmt.Errorf("failed to save service configuration: %v; plist restore failed: %w", err, restoreErr)
			}
		}
		return fmt.Errorf("failed to save service configuration: %w", err)
	}

	log.Printf("[MacBox Service] LaunchAgent 服务已卸载: %s", LabelFor(comp))
	return nil
}

func (sm *ServiceManager) restorePlist(path string, data []byte, had bool, cause error) {
	if !had {
		return
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		log.Printf("[MacBox Service] plist 回写失败: %v (原始错误: %v)", err, cause)
		return
	}
	_ = exec.Command("launchctl", "load", "-w", path).Run()
}

// migrateLegacyAgent boots out and removes the pre-split com.macbox.server
// agent. Called after a component agent is successfully loaded.
func (sm *ServiceManager) migrateLegacyAgent() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	legacyPath := filepath.Join(home, "Library", "LaunchAgents", ServiceLabel+".plist")
	if _, err := os.Stat(legacyPath); err != nil {
		return nil
	}
	if err := exec.Command("launchctl", "unload", "-w", legacyPath).Run(); err != nil {
		_ = exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), ServiceLabel)).Run()
	}
	if err := os.Remove(legacyPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	log.Printf("[MacBox Service] 已迁移并移除旧版 LaunchAgent: %s", ServiceLabel)
	return nil
}
