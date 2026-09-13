package system

import (
	"os"
	"testing"
)

func TestGetSystemStats(t *testing.T) {
	if os.Getenv("MACBOX_INTEGRATION") != "1" {
		t.Skip("host statistics integration test; set MACBOX_INTEGRATION=1 to run")
	}
	stats, err := GetSystemStats()
	if err != nil {
		t.Fatalf("GetSystemStats error: %v", err)
	}

	if stats.CPUCores <= 0 {
		t.Errorf("expected CPUCores > 0, got %d", stats.CPUCores)
	}
	if stats.MemTotal == 0 {
		t.Errorf("expected MemTotal > 0, got %d", stats.MemTotal)
	}
	if stats.OS == "" {
		t.Errorf("expected OS not empty")
	}
	if stats.PrimaryIP == "" {
		t.Errorf("expected PrimaryIP not empty")
	}
}

func TestFormatUptime(t *testing.T) {
	res := formatUptime(3665)
	if res == "" {
		t.Errorf("expected non-empty uptime string")
	}
}
