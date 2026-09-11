package system

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type TerminalSettings struct {
	DefaultLoginUser string `json:"defaultLoginUser"` // "root" | "default"
	FontSize         int    `json:"fontSize"`
	CursorStyle      string `json:"cursorStyle"` // "block" | "underline" | "bar"
}

type TerminalSettingsManager struct {
	filePath string
	mu       sync.RWMutex
	settings TerminalSettings
}

func normalizeTerminalSettings(settings TerminalSettings) (TerminalSettings, error) {
	if settings.DefaultLoginUser == "" {
		settings.DefaultLoginUser = "default"
	}
	if settings.DefaultLoginUser != "root" && settings.DefaultLoginUser != "default" {
		return TerminalSettings{}, fmt.Errorf("默认登录用户无效")
	}
	if settings.FontSize == 0 {
		settings.FontSize = 13
	}
	if settings.FontSize < 9 || settings.FontSize > 32 {
		return TerminalSettings{}, fmt.Errorf("终端字体大小必须在 9 到 32 之间")
	}
	if settings.CursorStyle == "" {
		settings.CursorStyle = "block"
	}
	switch settings.CursorStyle {
	case "block", "underline", "bar":
	default:
		return TerminalSettings{}, fmt.Errorf("光标样式无效")
	}
	return settings, nil
}

func NewTerminalSettingsManager(configDir string) *TerminalSettingsManager {
	mgr := &TerminalSettingsManager{
		filePath: filepath.Join(configDir, "terminal_settings.json"),
		settings: TerminalSettings{
			DefaultLoginUser: "default",
			FontSize:         13,
			CursorStyle:      "block",
		},
	}
	mgr.load()
	return mgr
}

func (m *TerminalSettingsManager) load() {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return
	}
	_ = os.Chmod(m.filePath, 0600)
	var loaded TerminalSettings
	if err := json.Unmarshal(data, &loaded); err != nil {
		return
	}
	if normalized, err := normalizeTerminalSettings(loaded); err == nil {
		m.settings = normalized
	}
}

func (m *TerminalSettingsManager) save() error {
	data, err := json.MarshalIndent(m.settings, "", "  ")
	if err != nil {
		return err
	}
	tmpFile, err := os.CreateTemp(filepath.Dir(m.filePath), ".terminal-settings-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmpFile.Chmod(0600); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, m.filePath); err != nil {
		return err
	}
	return os.Chmod(m.filePath, 0600)
}

func (m *TerminalSettingsManager) Get() TerminalSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings
}

func (m *TerminalSettingsManager) Update(newSettings TerminalSettings) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	normalized, err := normalizeTerminalSettings(newSettings)
	if err != nil {
		return err
	}

	original := m.settings
	m.settings = normalized
	if err := m.save(); err != nil {
		m.settings = original
		return err
	}
	return nil
}
