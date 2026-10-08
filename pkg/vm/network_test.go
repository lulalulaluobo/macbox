package vm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBridgeIPIgnoresInternalAndInvalidInterfaces(t *testing.T) {
	for _, raw := range []string{`invalid`, `[{"ifname":"eth0","addr_info":[{"family":"inet","scope":"global","local":"192.168.5.15"}]}]`, `[{"ifname":"docker0","addr_info":[{"family":"inet","scope":"global","local":"172.17.0.1"}]}]`, `[{"ifname":"lima0","addr_info":[{"family":"inet","scope":"global","local":"169.254.1.2"}]}]`} {
		if got := parseBridgeIP(raw); got != "" {
			t.Fatalf("invalid bridge IP %q", got)
		}
	}
	if got := parseBridgeIP(`[{"ifname":"lima0","addr_info":[{"family":"inet","scope":"global","local":"192.168.2.24"}]}]`); got != "192.168.2.24" {
		t.Fatalf("IP %s", got)
	}
}

func TestBridgeConfigurationPreservesOtherNetworks(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, ".lima", "_config", "networks.yaml")
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, []byte("networks:\n  custom:\n    mode: shared\n"), 0600)
	if err := configureBridgeNetwork(home, "en1"); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	for _, part := range []string{"custom:", "macbox-bridged:", "interface: en1", bridgeBinary} {
		if !strings.Contains(string(data), part) {
			t.Fatalf("missing %s", part)
		}
	}
	if err := configureBridgeNetwork(home, "utun0"); err == nil {
		t.Fatal("tunnel accepted as physical adapter")
	}
}
