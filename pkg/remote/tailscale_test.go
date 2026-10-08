package remote

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestStatusStatesAndSensitiveData(t *testing.T) {
	for _, tt := range []struct{ backend, want string }{
		{"NotInstalled", "notInstalled"}, {"NeedsLogin", "needsLogin"}, {"NeedsMachineAuth", "needsApproval"},
		{"Stopped", "paused"}, {"Starting", "connecting"}, {"Running", "connected"}, {"NoState", "unavailable"},
	} {
		t.Run(tt.backend, func(t *testing.T) {
			raw := `{"BackendState":"` + tt.backend + `","TailscaleIPs":["192.168.2.68","100.200.0.1","100.100.0.2"],"AuthURL":"https://login.tailscale.com/a/test","Self":{"HostName":"macbox","DNSName":"macbox.example.ts.net."},"Health":["secret authorization URL"]}`
			s, err := parseStatus(raw)
			if err != nil || s.State != tt.want || s.IP != "100.100.0.2" || s.DNSName != "macbox.example.ts.net" {
				t.Fatalf("unexpected status: %#v, %v", s, err)
			}
			if s.Installed == (tt.backend == "NotInstalled") {
				t.Fatal("incorrect installation state")
			}
			if (s.AuthURL != "") != (tt.backend == "NeedsLogin") {
				t.Fatal("authorization URL exposed in wrong state")
			}
			if strings.Contains(strings.Join(s.Health, ""), "secret") {
				t.Fatal("raw health text leaked")
			}
		})
	}
	expired, err := parseStatus(`{"BackendState":"Running","Self":{"Expired":true},"AuthURL":"https://login.tailscale.com/a/test"}`)
	if err != nil || expired.State != "expired" || expired.AuthURL == "" {
		t.Fatal("expired login not surfaced")
	}
	if _, err := parseStatus("invalid"); err == nil {
		t.Fatal("malformed status accepted")
	}
}

func TestOnlyOfficialAuthorizationLinks(t *testing.T) {
	for _, raw := range []string{
		"http://login.tailscale.com/a/key", "https://evil.test/a/key", "https://login.tailscale.com.evil.test/a/key",
		"https://user@login.tailscale.com/a/key", "https://login.tailscale.com:443/a/key",
		"javascript:alert(1)", "https://login.tailscale.com/admin", "https://login.tailscale.com/a/key#fragment",
	} {
		if validAuthURL(raw) {
			t.Errorf("accepted unsafe URL %q", raw)
		}
	}
	if !validAuthURL("https://login.tailscale.com/a/example") {
		t.Fatal("official URL rejected")
	}
}

type fakeGuest struct {
	states   []string
	commands [][]string
	unit     string
	upErr    error
}

func (g *fakeGuest) Exec(_ context.Context, args ...string) (string, error) {
	g.commands = append(g.commands, append([]string{}, args...))
	if len(args) == 3 && args[0] == "sh" && args[2] == statusCommand {
		result := g.states[0]
		if len(g.states) > 1 {
			g.states = g.states[1:]
		}
		return result, nil
	}
	if strings.Contains(strings.Join(args, " "), "/login-interactive") {
		return "sensitive login output", g.upErr
	}
	if args[0] == "systemctl" {
		return "active\n", nil
	}
	return "", nil
}
func (g *fakeGuest) ExecWithInput(_ context.Context, reader io.Reader, args ...string) (string, error) {
	body, _ := io.ReadAll(reader)
	g.unit = string(body)
	g.commands = append(g.commands, args)
	return "", nil
}

func TestConnectStartsOfficialAuthorization(t *testing.T) {
	g := &fakeGuest{states: []string{`{"BackendState":"NeedsLogin"}`, `{"BackendState":"NeedsLogin","AuthURL":"https://login.tailscale.com/a/example"}`}}
	m := NewManager(g, 19808)
	if err := m.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(g.unit, "bind=$$ip") || !strings.Contains(g.unit, "TCP4:host.lima.internal:19808") {
		t.Fatal("relay must bind only the remote address and fixed console destination")
	}
}

func TestResumePreservesExistingPreferences(t *testing.T) {
	g := &fakeGuest{states: []string{`{"BackendState":"Stopped","TailscaleIPs":["100.100.0.2"]}`, `{"BackendState":"Running","TailscaleIPs":["100.100.0.2"]}`}}
	if err := NewManager(g, 19808).Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, cmd := range g.commands {
		line := strings.Join(cmd, " ")
		if strings.Contains(line, "--accept-") || strings.Contains(line, "--hostname") || strings.Contains(line, "login-interactive") {
			t.Fatal("resume changed existing preferences")
		}
	}
}

func TestFailedLoginNeverReturnsCommandOutput(t *testing.T) {
	g := &fakeGuest{states: []string{`{"BackendState":"NeedsLogin"}`}, upErr: errors.New("secret")}
	err := NewManager(g, 19808).Connect(context.Background())
	if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "sensitive") {
		t.Fatal("failed login leaked command output")
	}
}

func TestOperationsAreExclusive(t *testing.T) {
	m := NewManager(nil, 19808)
	if !m.Begin("install") || m.Begin("connect") || !m.Active() {
		t.Fatal("duplicate operation accepted")
	}
	m.End()
	if !m.Begin("connect") {
		t.Fatal("operation reservation not released")
	}
	m.End()
}
