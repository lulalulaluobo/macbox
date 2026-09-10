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
}

func TestConfigDir(t *testing.T) {
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
