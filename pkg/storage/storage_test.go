package storage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/lulalulaluobo/macbox/pkg/config"
)

func TestListDisks(t *testing.T) {
	if os.Getenv("MACBOX_INTEGRATION") != "1" {
		t.Skip("diskutil integration test; set MACBOX_INTEGRATION=1 to run against a disposable host")
	}

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
	// AddOrUpdateLocalMount and the toggle/delete helpers persist config. Use a
	// disposable home so this test cannot modify the user's MacBox configuration.
	t.Setenv("HOME", t.TempDir())
	for _, folder := range []string{"Downloads", "Movies", "Pictures"} {
		if err := os.MkdirAll(filepath.Join(os.Getenv("HOME"), folder), 0755); err != nil {
			t.Fatalf("create candidate folder: %v", err)
		}
	}

	defaults := GetDefaultMacMounts()
	t.Logf("Found %d default Mac user mounts", len(defaults))
	for _, d := range defaults {
		t.Logf("Default mount: %s -> %s (target: %s)", d.Name, d.HostPath, d.GuestTarget)
	}

	cfg := &config.Config{
		Storage: config.StorageConfig{},
	}
	candidates := ScanLocalMountCandidates(cfg)
	var downloadsCandidate *LocalMountCandidate
	for i := range candidates {
		if candidates[i].Name == "Downloads" {
			downloadsCandidate = &candidates[i]
			break
		}
	}
	if downloadsCandidate == nil || !downloadsCandidate.Available {
		t.Fatalf("expected Downloads to be discovered as an available candidate: %#v", downloadsCandidate)
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

func TestAddOrUpdateLocalMountRejectsGuestPathEscape(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	hostDir := t.TempDir()
	cfg := &config.Config{}

	err := AddOrUpdateLocalMount(cfg, config.LocalMount{
		ID:          "unsafe-target",
		Name:        "Unsafe target",
		HostPath:    hostDir,
		GuestTarget: "../../outside",
	})
	if err == nil {
		t.Fatal("AddOrUpdateLocalMount accepted a guest path outside /data")
	}
	if len(cfg.Storage.LocalMounts) != 0 {
		t.Fatal("rejected mount was added to configuration")
	}
}

func TestValidateStorageTargetDir(t *testing.T) {
	home := t.TempDir()
	mountPoint := t.TempDir()

	if err := validateStorageTargetDir(filepath.Join(mountPoint, "MacBox-Pool"), mountPoint, home, false); err != nil {
		t.Fatalf("expected target inside selected volume to be accepted: %v", err)
	}
	if err := validateStorageTargetDir(filepath.Join(home, "MacBox-Pool"), "", home, false); err != nil {
		t.Fatalf("expected target inside home to be accepted: %v", err)
	}
	if err := validateStorageTargetDir(filepath.Join(home, "MacBox-Pool"), "/Volumes/Data", home, true); err != nil {
		t.Fatalf("expected internal Data volume to allow the user's home directory: %v", err)
	}
	if err := validateStorageTargetDir(filepath.Join(home, "MacBox-Pool"), "/Volumes/FastSSD", home, false); err == nil {
		t.Fatal("external volume unexpectedly accepted a target outside the selected volume")
	}
	if err := validateStorageTargetDir(filepath.Join(mountPoint, "..", "outside"), mountPoint, home, false); err == nil {
		t.Fatal("target outside selected volume was accepted")
	}
	if err := validateStorageTargetDir("/etc/macbox", mountPoint, home, false); err == nil {
		t.Fatal("system directory was accepted as storage target")
	}

	outside := t.TempDir()
	link := filepath.Join(mountPoint, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatalf("create escape symlink: %v", err)
	}
	if err := validateStorageTargetDir(link, mountPoint, home, false); err == nil {
		t.Fatal("symlink target was accepted")
	}
}

func TestSelectUsableAPFSVolume(t *testing.T) {
	volumes := []apfsVolumeEntry{
		{VolumeName: "iSCPreboot", MountPoint: "/System/Volumes/iSCPreboot", CapacityInUse: 1},
		{VolumeName: "Macintosh HD", MountPoint: "/Volumes/Macintosh HD", CapacityInUse: 2},
		{VolumeName: "Data", MountPoint: "/Volumes/Data", CapacityInUse: 3},
	}
	selected := selectUsableAPFSVolume(volumes)
	if selected == nil || selected.MountPoint != "/Volumes/Data" {
		t.Fatalf("selected APFS volume = %+v, want writable Data volume", selected)
	}

	helpersOnly := []apfsVolumeEntry{
		{VolumeName: "Preboot", MountPoint: "/System/Volumes/Preboot"},
		{VolumeName: "Recovery", MountPoint: "/private/tmp/recovery"},
	}
	if selected := selectUsableAPFSVolume(helpersOnly); selected != nil {
		t.Fatalf("selected helper APFS volume %+v", selected)
	}
}

func TestSystemHelperMountPoint(t *testing.T) {
	if !isSystemHelperMountPoint("/System/Volumes/iSCPreboot") {
		t.Fatal("iSCPreboot must be rejected as a storage target")
	}
	if isSystemHelperMountPoint("/Volumes/Data") || isSystemHelperMountPoint("/System/Volumes/Data") {
		t.Fatal("writable data volumes must remain valid storage targets")
	}
}

func TestRecommendedSecondaryTargetDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	if got := recommendedSecondaryTargetDir("/System/Volumes/iSCPreboot", false); got != "" {
		t.Fatalf("helper volume received recommendation %q", got)
	}
	if got, want := recommendedSecondaryTargetDir("/System/Volumes/Data", false), filepath.Join(home, "MacBox-SSD-Pool"); got != want {
		t.Fatalf("internal data recommendation = %q, want %q", got, want)
	}
	if got, want := recommendedSecondaryTargetDir("/Volumes/Data", false), filepath.Join(home, "MacBox-SSD-Pool"); got != want {
		t.Fatalf("internal /Volumes/Data recommendation = %q, want %q", got, want)
	}
	if got, want := recommendedSecondaryTargetDir("/Volumes/FastSSD", true), "/Volumes/FastSSD/MacBox-SSD-Pool"; got != want {
		t.Fatalf("external volume recommendation = %q, want %q", got, want)
	}
}

func TestUnbindExternalDiskRestoresBackupWhenImageIsMissing(t *testing.T) {
	testHome := t.TempDir()
	t.Setenv("HOME", testHome)
	cfg := config.DefaultConfig()
	cfg.Storage.SelectedDisk = "disk4"
	cfg.Storage.MountPoint = "/System/Volumes/Data"
	cfg.Storage.DataPath = filepath.Join(testHome, "MacBox", "datadisk.img")

	diskDir := filepath.Join(testHome, ".lima", "_disks", "macbox-data")
	if err := os.MkdirAll(diskDir, 0700); err != nil {
		t.Fatalf("create Lima disk directory: %v", err)
	}
	diskPath := filepath.Join(diskDir, "datadisk")
	if err := os.Symlink(cfg.Storage.DataPath, diskPath); err != nil {
		t.Fatalf("create broken external disk link: %v", err)
	}
	backupPath := filepath.Join(diskDir, "datadisk.internal.bak")
	if err := os.WriteFile(backupPath, []byte("internal backup"), 0600); err != nil {
		t.Fatalf("create internal backup: %v", err)
	}

	if err := UnbindExternalDisk(cfg); err != nil {
		t.Fatalf("unbind should restore an internal backup after external image loss: %v", err)
	}
	content, err := os.ReadFile(diskPath)
	if err != nil {
		t.Fatalf("read restored internal data disk: %v", err)
	}
	if string(content) != "internal backup" {
		t.Fatalf("restored data disk content = %q, want internal backup", content)
	}
	if cfg.Storage.DataPath != "" || cfg.Storage.SelectedDisk != "" || cfg.Storage.MountPoint != "" {
		t.Fatalf("external storage config was not cleared: %+v", cfg.Storage)
	}
}
