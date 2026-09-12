package config

import (
	"os"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.Port != 19808 {
		t.Errorf("expected port 19808, got %d", cfg.Port)
	}
	if cfg.VM.Name != "macnas" {
		t.Errorf("expected VM name macnas, got %s", cfg.VM.Name)
	}
	if cfg.Samba.ShareName != "MacNAS" {
		t.Errorf("expected Samba share name MacNAS, got %s", cfg.Samba.ShareName)
	}
	if cfg.Samba.Password != "" {
		t.Errorf("DefaultConfig must not contain a reusable Samba password")
	}
}

func TestConfigDir(t *testing.T) {
	// Keep the test hermetic: ConfigDir creates ~/.macnas, so never point it at
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

func TestLoadConfigGeneratesSambaSecret(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig error: %v", err)
	}
	if len(cfg.Samba.Password) < 32 {
		t.Fatalf("generated Samba password is too short: %d", len(cfg.Samba.Password))
	}
	if cfg.Samba.Password == legacySambaPassword {
		t.Fatal("LoadConfig generated the legacy Samba password")
	}

	path, err := ConfigFilePath()
	if err != nil {
		t.Fatalf("ConfigFilePath error: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat config file: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("config file permissions = %o, want 600", info.Mode().Perm())
	}

	reloaded, err := LoadConfig()
	if err != nil {
		t.Fatalf("reload config error: %v", err)
	}
	if reloaded.Samba.Password != cfg.Samba.Password {
		t.Fatal("reloading config rotated the Samba password unexpectedly")
	}
}

func TestEnsureSecretsRejectsWeakExistingSambaPassword(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Samba.Password = "weak"
	if err := EnsureSecrets(cfg); err == nil {
		t.Fatal("EnsureSecrets accepted a weak existing Samba password")
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
	if got, err := NormalizeDataDiskName(""); err != nil || got != "macnas-data" {
		t.Fatalf("empty disk name = %q, %v; want macnas-data", got, err)
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
	for _, input := range []string{"", "localhost", "nas.local", "not-an-ip"} {
		if got := NormalizeListenAddress(input); got != "127.0.0.1" {
			t.Errorf("NormalizeListenAddress(%q) = %q, want loopback", input, got)
		}
	}
	if got := NormalizeListenAddress("0.0.0.0"); got != "0.0.0.0" {
		t.Errorf("explicit bind address normalized to %q", got)
	}
}
