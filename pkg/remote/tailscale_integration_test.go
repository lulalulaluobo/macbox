package remote_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/remote"
	"github.com/lulalulaluobo/macbox/pkg/vm"
)

// Explicit opt-in: installs official packages in the developer's running VM.
// It never authorizes an account or clears existing device credentials.
func TestLocalVMInstallation(t *testing.T) {
	if os.Getenv("MACBOX_REMOTE_INTEGRATION") != "1" {
		t.Skip("local installation requires explicit opt-in")
	}
	guest := vm.NewManager(config.DefaultConfig())
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	manager := remote.NewManager(guest, 19808)
	if err := manager.Install(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := guest.Exec(ctx, "sudo", "-n", "systemd-analyze", "verify", "/etc/systemd/system/macbox-remote-access.service"); err != nil {
		t.Fatal("remote service unit validation failed")
	}
	if err := manager.Connect(ctx); err != nil {
		t.Fatal(err)
	}
	status, err := manager.Status(ctx)
	if err != nil || !status.Installed {
		t.Fatal("official client status unavailable")
	}
	if status.State == "needsLogin" && !strings.HasPrefix(status.AuthURL, "https://login.tailscale.com/a/") {
		t.Fatal("official account authorization unavailable")
	}
	t.Logf("client installed: version=%s state=%s authorizationReady=%t", status.Version, status.State, status.AuthURL != "")
}
