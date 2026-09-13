package backup

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lulalulaluobo/macbox/pkg/config"
)

func TestCreateAndReadConfigurationBackup(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	configDir, err := config.ConfigDir()
	if err != nil {
		t.Fatalf("ConfigDir() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte("port: 19808\n"), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "users.json"), []byte(`{"users":[]}`), 0600); err != nil {
		t.Fatalf("write users: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "terminal_settings.json"), []byte(`{"shell":"zsh"}`), 0600); err != nil {
		t.Fatalf("write terminal settings: %v", err)
	}

	appDir, err := ApplicationDataDir()
	if err != nil {
		t.Fatalf("ApplicationDataDir() error = %v", err)
	}
	customDir := filepath.Join(appDir, "custom_apps")
	if err := os.MkdirAll(customDir, 0700); err != nil {
		t.Fatalf("create custom apps directory: %v", err)
	}
	customApp := map[string]any{
		"metadata": map[string]any{"id": "demo", "name": "Demo"},
		"yaml":     "services:\n  demo:\n    image: nginx:alpine\n",
	}
	customData, err := json.Marshal(customApp)
	if err != nil {
		t.Fatalf("marshal custom app: %v", err)
	}
	if err := os.WriteFile(filepath.Join(customDir, "demo.json"), customData, 0600); err != nil {
		t.Fatalf("write custom app: %v", err)
	}

	var output bytes.Buffer
	manifest, err := Create(&output)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if !strings.Contains(manifest.Warning, "未加密") {
		t.Fatalf("backup warning = %q, want unencrypted warning", manifest.Warning)
	}

	archive, err := Read(output.Bytes())
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	for _, name := range []string{ManifestEntryPath, ConfigEntryPath, UsersEntryPath, TerminalSettingsEntryPath, CustomAppsEntryPrefix + "demo.json"} {
		if _, ok := archive.Files[name]; !ok {
			t.Errorf("backup is missing %q", name)
		}
	}
	if _, ok := archive.Files["data/should-not-be-included"]; ok {
		t.Fatal("backup unexpectedly contains data files")
	}
}

func TestReadRejectsUnsafeOrDuplicateEntries(t *testing.T) {
	tests := []struct {
		name       string
		entryNames []string
		want       string
	}{
		{name: "path traversal", entryNames: []string{"../config.yaml"}, want: "非法路径"},
		{name: "duplicate", entryNames: []string{ManifestEntryPath, ManifestEntryPath}, want: "重复文件"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var output bytes.Buffer
			writer := zip.NewWriter(&output)
			for _, name := range tt.entryNames {
				file, err := writer.Create(name)
				if err != nil {
					t.Fatalf("Create(%q) error = %v", name, err)
				}
				if _, err := file.Write([]byte("test")); err != nil {
					t.Fatalf("write %q: %v", name, err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatalf("close zip: %v", err)
			}
			_, err := Read(output.Bytes())
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Read() error = %v, want substring %q", err, tt.want)
			}
		})
	}
}
