package storage

import (
	"testing"
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
			t.Logf("Disk: %s (%s) size: %s external: %v", d.Name, d.DeviceIdentifier, d.TotalSizeString, d.IsExternal)
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
