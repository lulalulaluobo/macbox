package apps

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPublishedHostPorts(t *testing.T) {
	content := `services:
  filebrowser:
    ports:
      - "8082:80"
      - "127.0.0.1:8085:8080/tcp"
      - "53:53/udp"
  long-form:
    ports:
      - target: 80
        published: 8080
`

	got, err := publishedHostPorts(content)
	if err != nil {
		t.Fatalf("publishedHostPorts() error = %v", err)
	}
	want := []int{53, 8080, 8082, 8085}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("publishedHostPorts() = %v, want %v", got, want)
	}
}

func TestPublishedHostPortsRejectsInvalidCompose(t *testing.T) {
	if _, err := publishedHostPorts("services: ["); err == nil {
		t.Fatal("publishedHostPorts() accepted invalid YAML")
	}
}

func TestNormalizeInstallConfig(t *testing.T) {
	got, err := normalizeInstallConfig(InstallCustomConfig{
		PortsMap:   map[string]int{" 08082 ": 18082},
		VolumesMap: map[string]string{"/config/../config": "/data/appdata/example/config/"},
		EnvMap:     map[string]string{"APP_MODE": "$literal"},
	})
	if err != nil {
		t.Fatalf("normalizeInstallConfig() error = %v", err)
	}
	if got.PortsMap["8082"] != 18082 {
		t.Fatalf("normalized port map = %#v", got.PortsMap)
	}
	if got.VolumesMap["/config"] != "/data/appdata/example/config" {
		t.Fatalf("normalized volume map = %#v", got.VolumesMap)
	}
	if got.EnvMap["APP_MODE"] != "$literal" {
		t.Fatalf("normalized env map = %#v", got.EnvMap)
	}
}

func TestNormalizeInstallConfigRejectsUnsafeValues(t *testing.T) {
	tests := []struct {
		name  string
		input InstallCustomConfig
	}{
		{name: "invalid container port", input: InstallCustomConfig{PortsMap: map[string]int{"not-a-port": 8080}}},
		{name: "invalid host port", input: InstallCustomConfig{PortsMap: map[string]int{"80": 0}}},
		{name: "host path escape", input: InstallCustomConfig{VolumesMap: map[string]string{"/config": "/etc"}}},
		{name: "container path relative", input: InstallCustomConfig{VolumesMap: map[string]string{"config": "/data/config"}}},
		{name: "environment injection", input: InstallCustomConfig{EnvMap: map[string]string{"BAD\nKEY": "value"}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := normalizeInstallConfig(tt.input); err == nil {
				t.Fatal("normalizeInstallConfig() accepted unsafe value")
			}
		})
	}
}

func TestComposeEnvironmentItemEscapesInterpolation(t *testing.T) {
	item := composeEnvironmentItem("SECRET", "$literal")
	if item != "SECRET=$$literal" {
		t.Fatalf("composeEnvironmentItem() = %q, want %q", item, "SECRET=$$literal")
	}
}

func TestCustomAppManagerValidatesAndStoresSafely(t *testing.T) {
	manager := NewCustomAppManager(t.TempDir())
	meta, err := manager.Save(CustomAppInput{
		ID:          "safe-app",
		Name:        "Safe app",
		ComposeYAML: "services:\n  web:\n    image: nginx:alpine\n",
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if meta.ID != "safe-app" {
		t.Fatalf("saved metadata ID = %q", meta.ID)
	}
	filePath := filepath.Join(manager.storageDir, "safe-app.json")
	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("Stat() error = %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("custom app file mode = %o, want 600", info.Mode().Perm())
	}
	if records, err := manager.List(); err != nil || len(records) != 1 {
		t.Fatalf("List() = %d records, error = %v", len(records), err)
	}
}

func TestCustomAppManagerRejectsUnsafeInput(t *testing.T) {
	manager := NewCustomAppManager(t.TempDir())
	tests := []CustomAppInput{
		{ID: "../escape", Name: "app", ComposeYAML: "services:\n  web: {}\n"},
		{ID: "broken", Name: "app", ComposeYAML: "services: ["},
		{ID: "missing-services", Name: "app", ComposeYAML: "name: app\n"},
		{ID: "bad-port", Name: "app", Port: 70000, ComposeYAML: "services:\n  web: {}\n"},
	}
	for _, input := range tests {
		if _, err := manager.Save(input); err == nil {
			t.Fatalf("Save() accepted unsafe input %#v", input)
		}
	}
}
