package system

import (
	"testing"
)

func TestGetSystemStats(t *testing.T) {
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
