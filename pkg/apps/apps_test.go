package apps

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestBuiltinCatalogContainsComposeAndDownloadApps(t *testing.T) {
	want := map[string]struct {
		category string
		port     int
	}{
		"dockge":       {category: "系统运维", port: 5001},
		"xunlei":       {category: "下载工具", port: 2345},
		"baidunetdisk": {category: "下载工具", port: 6080},
	}

	seen := make(map[string]bool)
	for _, item := range GetBuiltinCatalog() {
		if _, duplicate := seen[item.Metadata.ID]; duplicate {
			t.Fatalf("builtin catalog contains duplicate app ID %q", item.Metadata.ID)
		}
		seen[item.Metadata.ID] = true
		if expected, ok := want[item.Metadata.ID]; ok {
			if item.Metadata.Category != expected.category || item.Metadata.Port != expected.port {
				t.Fatalf("app %q metadata = category %q / port %d, want %q / %d", item.Metadata.ID, item.Metadata.Category, item.Metadata.Port, expected.category, expected.port)
			}
			if item.Metadata.Source != "community" {
				t.Fatalf("app %q source = %q, want community", item.Metadata.ID, item.Metadata.Source)
			}
			if item.YAML == "" {
				t.Fatalf("app %q has an empty compose template", item.Metadata.ID)
			}
			var document struct {
				Services map[string]any `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte(item.YAML), &document); err != nil {
				t.Fatalf("app %q compose template is invalid: %v", item.Metadata.ID, err)
			}
			if len(document.Services) == 0 {
				t.Fatalf("app %q compose template has no services", item.Metadata.ID)
			}
		}
	}

	for id := range want {
		if !seen[id] {
			t.Fatalf("builtin catalog is missing app %q", id)
		}
	}
}

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

func TestMigrateAListDataBind(t *testing.T) {
	oldCompose := `services:
  alist:
    container_name: macbox-alist
    volumes:
      - /data/appdata/alist/data:/opt/alist/data
      - "/data:/data"
`
	updated, changed := migrateAListDataBind(oldCompose)
	if !changed {
		t.Fatal("migrateAListDataBind() did not migrate the legacy mount")
	}
	if !strings.Contains(updated, "propagation: rslave") {
		t.Fatalf("migrated Compose does not enable rslave propagation:\n%s", updated)
	}
	if strings.Contains(updated, `- "/data:/data"`) {
		t.Fatalf("migrated Compose still contains the legacy data bind:\n%s", updated)
	}

	if second, changedAgain := migrateAListDataBind(updated); changedAgain || second != updated {
		t.Fatal("migrateAListDataBind() is not idempotent")
	}
}

func TestMigrateXunleiDownloadBind(t *testing.T) {
	oldCompose := `services:
  xunlei:
    volumes:
      - "/data/downloads:/xunlei/downloads"
      - /data/appdata/xunlei/data:/xunlei/data
`
	updated, changed := migrateXunleiDownloadBind(oldCompose)
	if !changed {
		t.Fatal("migrateXunleiDownloadBind() did not migrate the legacy mount")
	}
	if !strings.Contains(updated, "source: /data/downloads") || !strings.Contains(updated, "propagation: rslave") {
		t.Fatalf("migrated Compose does not propagate the download sub-mount:\n%s", updated)
	}
	if strings.Contains(updated, `"/data/downloads:/xunlei/downloads"`) {
		t.Fatalf("migrated Compose still contains the legacy download bind:\n%s", updated)
	}
	if second, changedAgain := migrateXunleiDownloadBind(updated); changedAgain || second != updated {
		t.Fatal("migrateXunleiDownloadBind() is not idempotent")
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
