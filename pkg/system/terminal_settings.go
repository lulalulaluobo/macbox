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

type AISkillsCandidate struct {
	Name        string `json:"name"`
	HostPath    string `json:"hostPath"`
	Description string `json:"description"`
	Available   bool   `json:"available"`
	SkillCount  int    `json:"skillCount"`
	Reason      string `json:"reason,omitempty"`
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

// DiscoverAISkillsCandidates returns the conventional local skill locations
// for AI CLIs. The browser may be on another device, so these are discovered
// by the MacNAS process on the Mac host rather than by a browser directory
// picker.
func DiscoverAISkillsCandidates() []AISkillsCandidate {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	definitions := []struct {
		name        string
		relative    string
		description string
	}{
		{name: "Agent Skills（推荐）", relative: ".agents/skills", description: "Codex、Claude 等 Agent CLI 的通用 Skill 目录"},
		{name: "Codex Skills", relative: ".codex/skills", description: "Codex CLI 的技能目录"},
		{name: "Claude Skills", relative: ".claude/skills", description: "Claude CLI 的技能目录"},
	}
	candidates := make([]AISkillsCandidate, 0, len(definitions))
	seen := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		path := filepath.Clean(filepath.Join(home, definition.relative))
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		candidate := AISkillsCandidate{
			Name:        definition.name,
			HostPath:    path,
			Description: definition.description,
		}
		info, statErr := os.Stat(path)
		if statErr != nil {
			candidate.Reason = "目录不存在"
		} else if !info.IsDir() {
			candidate.Reason = "路径不是目录"
		} else {
			candidate.Available = true
			if entries, readErr := os.ReadDir(path); readErr == nil {
				for _, entry := range entries {
					if entry.IsDir() {
						candidate.SkillCount++
					}
				}
			}
		}
		candidates = append(candidates, candidate)
	}
	return candidates
}
