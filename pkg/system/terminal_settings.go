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

// AISkillsDirectoryInfo validates a host directory in the shape expected by
// Agent CLIs: each immediate child directory must contain a SKILL.md file.
// Some skill managers keep that directory one level below their application
// root (for example ~/.skills-manager/skills), so this also accepts that
// layout and returns the actual skill directory.
func AISkillsDirectoryInfo(hostPath string) (string, int, error) {
	path := filepath.Clean(hostPath)
	info, err := os.Stat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.IsDir() {
		return "", 0, fmt.Errorf("AI Skill 路径必须是目录")
	}

	count, err := countAISkillDirectories(path)
	if err != nil {
		return "", 0, err
	}
	if count > 0 {
		return path, count, nil
	}

	nestedPath := filepath.Join(path, "skills")
	nestedCount, nestedErr := countAISkillDirectories(nestedPath)
	if nestedErr == nil && nestedCount > 0 {
		return nestedPath, nestedCount, nil
	}

	return "", 0, fmt.Errorf("目录中未发现 Skill：请选择直接包含各 Skill 子目录/SKILL.md 的目录")
}

func countAISkillDirectories(path string) (int, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, entry := range entries {
		entryPath := filepath.Join(path, entry.Name())
		entryInfo, statErr := os.Stat(entryPath)
		if statErr != nil || !entryInfo.IsDir() {
			continue
		}
		skillInfo, skillErr := os.Stat(filepath.Join(entryPath, "SKILL.md"))
		if skillErr == nil && !skillInfo.IsDir() {
			count++
		}
	}
	return count, nil
}

// DiscoverAISkillsCandidates returns the conventional local skill locations
// for AI CLIs. The browser may be on another device, so these are discovered
// by the MacBox process on the Mac host rather than by a browser directory
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
		{name: "Skills Manager（推荐）", relative: ".skills-manager/skills", description: "skills-manager 管理的通用 Skill 目录"},
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
			_, candidate.SkillCount, statErr = AISkillsDirectoryInfo(path)
			if statErr != nil {
				candidate.Reason = statErr.Error()
			} else {
				candidate.Available = true
			}
		}
		candidates = append(candidates, candidate)
	}
	return candidates
}
