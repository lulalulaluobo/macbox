package storage

import (
	"testing"

	"github.com/luluen/mac-nas/pkg/config"
)

func TestListDisks(t *testing.T) {
	disks, err := ListDisks("")
	if err != nil {
		t.Fatalf("ListDisks error: %v", err)
	}

	if len(disks) == 0 {
		t.Logf("Warning: no disks found via diskutil list")
	} else {
		t.Logf("Found %d disks", len(disks))
		for _, d := range disks {
			t.Logf("Disk: %s (%s) size: %s external: %v, vol: %s, mount: %s, fs: %s, used: %s, free: %s, percent: %.1f%%",
				d.Name, d.DeviceIdentifier, d.TotalSizeString, d.IsExternal, d.VolumeName, d.MountPoint, d.FileSystem, d.UsedSpaceString, d.FreeSpaceString, d.UsedPercent)
		}
	}
}

func TestFormatBytes(t *testing.T) {
	cases := []struct {
		in  uint64
		out string
	}{
		{500, "500 B"},
		{1024, "1.0 KB"},
		{1024 * 1024 * 5, "5.0 MB"},
		{1024 * 1024 * 1024 * 20, "20.0 GB"},
	}

	for _, c := range cases {
		got := formatBytes(c.in)
		if got != c.out {
			t.Errorf("formatBytes(%d) = %s, expected %s", c.in, got, c.out)
		}
	}
}

func TestLocalMounts(t *testing.T) {
	defaults := GetDefaultMacMounts()
	t.Logf("Found %d default Mac user mounts", len(defaults))
	for _, d := range defaults {
		t.Logf("Default mount: %s -> %s (target: %s)", d.Name, d.HostPath, d.GuestTarget)
	}

	cfg := &config.Config{
		Storage: config.StorageConfig{},
	}

	configured, recommended := ListLocalMounts(cfg)
	if len(configured) != 0 {
		t.Errorf("expected 0 configured mounts, got %d", len(configured))
	}
	if len(recommended) != len(defaults) {
		t.Errorf("expected %d recommended mounts, got %d", len(defaults), len(recommended))
	}

	if len(defaults) > 0 {
		target := defaults[0]
		err := AddOrUpdateLocalMount(cfg, target)
		if err != nil {
			t.Fatalf("AddOrUpdateLocalMount error: %v", err)
		}

		configured, recommended = ListLocalMounts(cfg)
		if len(configured) != 1 {
			t.Errorf("expected 1 configured mount, got %d", len(configured))
		}

		// Test toggle
		enabled, err := ToggleLocalMount(cfg, target.ID)
		if err != nil || !enabled {
			t.Fatalf("ToggleLocalMount failed: %v, enabled: %v", err, enabled)
		}

		// Test delete
		err = DeleteLocalMount(cfg, target.ID)
		if err != nil {
			t.Fatalf("DeleteLocalMount failed: %v", err)
		}

		configured, _ = ListLocalMounts(cfg)
		if len(configured) != 0 {
			t.Errorf("expected 0 mounts after delete, got %d", len(configured))
		}
	}
}
