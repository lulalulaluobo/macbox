package config

import (
	"os"
	"strings"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.Port != 19808 {
		t.Errorf("expected port 19808, got %d", cfg.Port)
	}
	if cfg.VM.Name != "macbox" {
		t.Errorf("expected VM name macbox, got %s", cfg.VM.Name)
	}
	if cfg.Samba.ShareName != "MacBox" {
		t.Errorf("expected Samba share name MacBox, got %s", cfg.Samba.ShareName)
	}
}

func TestConfigDir(t *testing.T) {
	// Keep the test hermetic: ConfigDir creates ~/.macbox, so never point it at
	// the developer's real home directory.
	t.Setenv("HOME", t.TempDir())

	dir, err := ConfigDir()
	if err != nil {
		t.Fatalf("ConfigDir error: %v", err)
	}
	if dir == "" {
		t.Fatalf("ConfigDir is empty")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Errorf("ConfigDir does not exist: %v", err)
	}
}

func TestLoadConfigRemovesLegacyPlaintextSambaPassword(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	dir, err := ConfigDir()
	if err != nil {
		t.Fatalf("ConfigDir error: %v", err)
	}
	path := dir + "/config.yaml"
	legacy := "port: 19808\nsamba:\n  shareName: MacBox\n  port: 4455\n  user: admin\n  password: plaintext-admin-password\n"
	if err := os.WriteFile(path, []byte(legacy), 0600); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig error: %v", err)
	}
	if cfg.Samba.User != "admin" {
		t.Fatalf("Samba user = %q, want admin", cfg.Samba.User)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migrated config: %v", err)
	}
	if strings.Contains(string(data), "plaintext-admin-password") || strings.Contains(string(data), "password:") {
		t.Fatalf("legacy plaintext Samba password was not removed: %s", data)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat config file: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("config file permissions = %o, want 600", info.Mode().Perm())
	}

}

func TestValidateSambaPassword(t *testing.T) {
	if err := ValidateSambaPassword("weak"); err == nil {
		t.Fatal("ValidateSambaPassword accepted a weak password")
	}
	if err := ValidateSambaPassword("足够安全的密码"); err != nil {
		t.Fatalf("ValidateSambaPassword rejected a valid password: %v", err)
	}
}

func TestValidateSambaUsername(t *testing.T) {
	for _, username := range []string{"luobo", "中文管理员", "admin@example"} {
		if err := ValidateSambaUsername(username); err != nil {
			t.Errorf("ValidateSambaUsername(%q) returned error: %v", username, err)
		}
	}
	for _, username := range []string{"", "ab", "bad user", "bad=user", "#comment", "bad\nuser"} {
		if err := ValidateSambaUsername(username); err == nil {
			t.Errorf("ValidateSambaUsername(%q) accepted unsafe username", username)
		}
	}
}

func TestNormalizeGuestTarget(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "relative", input: "media/movies", want: "media/movies"},
		{name: "data absolute", input: "/data/media/movies", want: "media/movies"},
		{name: "data prefix", input: "data/photos", want: "photos"},
		{name: "escape", input: "/data/../../etc", wantErr: true},
		{name: "root", input: "/data", wantErr: true},
		{name: "control", input: "media/\nmovies", wantErr: true},
		{name: "backslash", input: `media\\movies`, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeGuestTarget(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("NormalizeGuestTarget(%q) succeeded, want error", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeGuestTarget(%q) error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("NormalizeGuestTarget(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeDataDiskName(t *testing.T) {
	if got, err := NormalizeDataDiskName(""); err != nil || got != "macbox-data" {
		t.Fatalf("empty disk name = %q, %v; want macbox-data", got, err)
	}
	if got, err := NormalizeDataDiskName("data_pool-1"); err != nil || got != "data_pool-1" {
		t.Fatalf("valid disk name = %q, %v", got, err)
	}
	for _, name := range []string{"../../etc", "data/name", "disk name", "-disk"} {
		if _, err := NormalizeDataDiskName(name); err == nil {
			t.Errorf("NormalizeDataDiskName(%q) succeeded, want error", name)
		}
	}
}

func TestNormalizeAISkillsHostPath(t *testing.T) {
	if got, err := NormalizeAISkillsHostPath("/Users/example/.agents/skills"); err != nil || got != "/Users/example/.agents/skills" {
		t.Fatalf("valid AI skills path = %q, %v", got, err)
	}
	for _, path := range []string{"", "/", "relative/.agents/skills", "/tmp/skills\n"} {
		got, err := NormalizeAISkillsHostPath(path)
		if path == "" {
			if err != nil || got != "" {
				t.Fatalf("empty AI skills path = %q, %v; want empty", got, err)
			}
			continue
		}
		if err == nil {
			t.Errorf("NormalizeAISkillsHostPath(%q) = %q, want error", path, got)
		}
	}
}

func TestNormalizeListenAddressDefaultsToLoopback(t *testing.T) {
	for _, input := range []string{"", "localhost", "storage.local", "not-an-ip"} {
		if got := NormalizeListenAddress(input); got != "127.0.0.1" {
			t.Errorf("NormalizeListenAddress(%q) = %q, want loopback", input, got)
		}
	}
	if got := NormalizeListenAddress("0.0.0.0"); got != "0.0.0.0" {
		t.Errorf("explicit bind address normalized to %q", got)
	}
}

func TestValidateServiceShortcut(t *testing.T) {
	valid := ServiceShortcut{
		ID:      "manual:piweb",
		Source:  "manual",
		Name:    "Pi Web",
		URL:     "http://192.168.2.123:30141",
		Icon:    "globe",
		Enabled: true,
	}
	if err := ValidateServiceShortcut(valid); err != nil {
		t.Fatalf("ValidateServiceShortcut rejected valid shortcut: %v", err)
	}

	invalid := []ServiceShortcut{
		{ID: "manual:bad", Source: "manual", Name: "Bad", URL: "javascript:alert(1)", Icon: "globe"},
		{ID: "manual:docker", Source: "manual", Name: "Bad", URL: "http://localhost", Icon: "globe", ContainerName: "alist"},
		{ID: "manual:source", Source: "other", Name: "Bad", URL: "http://localhost", Icon: "globe"},
		{ID: "docker:missing", Source: "docker", Name: "Docker", URL: "http://localhost", Icon: "box"},
	}
	for _, shortcut := range invalid {
		if err := ValidateServiceShortcut(shortcut); err == nil {
			t.Errorf("ValidateServiceShortcut accepted invalid shortcut %+v", shortcut)
		}
	}
}

func TestParseServiceNav(t *testing.T) {
	data := []byte(`serviceNav:
  - id: manual:piweb
    source: manual
    name: Pi Web
    url: http://127.0.0.1:30141
    icon: globe
    enabled: true
`)
	cfg, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse rejected service navigation: %v", err)
	}
	if len(cfg.ServiceNav) != 1 || cfg.ServiceNav[0].ID != "manual:piweb" {
		t.Fatalf("unexpected service navigation: %+v", cfg.ServiceNav)
	}
}
