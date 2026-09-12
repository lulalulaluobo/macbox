package system

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAISkillsDirectoryInfoAcceptsDirectAndManagerLayouts(t *testing.T) {
	root := t.TempDir()
	direct := filepath.Join(root, "direct")
	if err := os.MkdirAll(filepath.Join(direct, "demo-skill"), 0700); err != nil {
		t.Fatalf("create direct skill directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(direct, "demo-skill", "SKILL.md"), []byte("# demo"), 0600); err != nil {
		t.Fatalf("create direct SKILL.md: %v", err)
	}

	if got, count, err := AISkillsDirectoryInfo(direct); err != nil || got != direct || count != 1 {
		t.Fatalf("direct layout = (%q, %d, %v), want (%q, 1, nil)", got, count, err, direct)
	}

	managerRoot := filepath.Join(root, "manager")
	nested := filepath.Join(managerRoot, "skills", "nested-skill")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatalf("create nested skill directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nested, "SKILL.md"), []byte("# nested"), 0600); err != nil {
		t.Fatalf("create nested SKILL.md: %v", err)
	}

	if got, count, err := AISkillsDirectoryInfo(managerRoot); err != nil || got != filepath.Join(managerRoot, "skills") || count != 1 {
		t.Fatalf("manager layout = (%q, %d, %v), want nested skills path", got, count, err)
	}
}

func TestAISkillsDirectoryInfoRejectsDirectoryWithoutSkills(t *testing.T) {
	root := t.TempDir()
	if _, _, err := AISkillsDirectoryInfo(root); err == nil {
		t.Fatal("directory without Skill folders unexpectedly validated")
	}
}
