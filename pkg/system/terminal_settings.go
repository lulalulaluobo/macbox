package system

import (
	"encoding/json"
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
	_ = json.Unmarshal(data, &m.settings)
}

func (m *TerminalSettingsManager) save() error {
	data, err := json.MarshalIndent(m.settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.filePath, data, 0644)
}

func (m *TerminalSettingsManager) Get() TerminalSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings
}

func (m *TerminalSettingsManager) Update(newSettings TerminalSettings) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if newSettings.DefaultLoginUser != "root" && newSettings.DefaultLoginUser != "default" {
		newSettings.DefaultLoginUser = "default"
	}
	if newSettings.FontSize <= 8 || newSettings.FontSize > 32 {
		newSettings.FontSize = 13
	}
	if newSettings.CursorStyle == "" {
		newSettings.CursorStyle = "block"
	}

	m.settings = newSettings
	return m.save()
}
