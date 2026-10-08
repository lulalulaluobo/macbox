// Package remote wraps the official Tailscale client inside the Linux guest.
// Device credentials stay in /var/lib/tailscale and never enter MacBox config.
package remote

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Guest interface {
	Exec(context.Context, ...string) (string, error)
	ExecWithInput(context.Context, io.Reader, ...string) (string, error)
}

type Status struct {
	Installed    bool       `json:"installed"`
	State        string     `json:"state"`
	Message      string     `json:"message"`
	Version      string     `json:"version,omitempty"`
	DeviceName   string     `json:"deviceName,omitempty"`
	NetworkName  string     `json:"networkName,omitempty"`
	DNSName      string     `json:"dnsName,omitempty"`
	IP           string     `json:"ip,omitempty"`
	AuthURL      string     `json:"authURL,omitempty"`
	ConsoleURL   string     `json:"consoleURL,omitempty"`
	ConsoleReady bool       `json:"consoleReady"`
	KeyExpiry    *time.Time `json:"keyExpiry,omitempty"`
	Health       []string   `json:"health,omitempty"`
	Busy         bool       `json:"busy"`
}

type Manager struct {
	guest  Guest
	port   int
	mu     sync.Mutex
	active string
}

func NewManager(guest Guest, port int) *Manager { return &Manager{guest: guest, port: port} }
func (m *Manager) Begin(action string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != "" {
		return false
	}
	m.active = action
	return true
}
func (m *Manager) End()         { m.mu.Lock(); m.active = ""; m.mu.Unlock() }
func (m *Manager) Active() bool { m.mu.Lock(); defer m.mu.Unlock(); return m.active != "" }

const statusCommand = `if command -v tailscale >/dev/null 2>&1; then
 if systemctl is-active --quiet tailscaled; then
  sudo -n tailscale status --json --peers=false
 else
  printf '{"BackendState":"NoState"}'
 fi
else
 printf '{"BackendState":"NotInstalled"}'
fi`

func (m *Manager) Status(ctx context.Context) (Status, error) {
	raw, err := m.guest.Exec(ctx, "sh", "-c", statusCommand)
	if err != nil {
		return Status{State: "unavailable", Message: "暂时无法连接远程服务", Busy: m.Active()}, fmt.Errorf("无法读取远程连接，请检查运行系统")
	}
	status, err := parseStatus(raw)
	if err != nil {
		return Status{}, err
	}
	status.Busy = m.Active()
	if status.State == "connected" && status.IP != "" {
		out, _ := m.guest.Exec(ctx, "systemctl", "is-active", "macbox-remote-access.service")
		status.ConsoleReady = strings.TrimSpace(out) == "active"
		if status.ConsoleReady {
			status.ConsoleURL = "http://" + net.JoinHostPort(status.IP, strconv.Itoa(m.port))
		}
	}
	return status, nil
}

func parseStatus(raw string) (Status, error) {
	if len(raw) > 1<<20 {
		return Status{}, fmt.Errorf("远程状态过大，请稍后重试")
	}
	var doc struct {
		Version, BackendState, AuthURL string
		TailscaleIPs                   []string
		Self                           *struct {
			HostName, DNSName string
			Expired           bool
			KeyExpiry         *time.Time
		}
		CurrentTailnet *struct{ Name string }
		Health         []string
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return Status{}, fmt.Errorf("远程状态无法读取，请稍后重试")
	}
	s := Status{Installed: doc.BackendState != "NotInstalled", Version: doc.Version}
	if doc.Self != nil {
		s.DeviceName = doc.Self.HostName
		s.DNSName = strings.TrimSuffix(doc.Self.DNSName, ".")
		s.KeyExpiry = doc.Self.KeyExpiry
	}
	if doc.CurrentTailnet != nil {
		s.NetworkName = doc.CurrentTailnet.Name
	}
	for _, address := range doc.TailscaleIPs {
		if ip := net.ParseIP(address); ip != nil && ip.To4() != nil && tailIP(ip) {
			s.IP = ip.String()
			break
		}
	}
	switch doc.BackendState {
	case "NotInstalled":
		s.State = "notInstalled"
		s.Message = "开启后可在外面访问应用和后台"
	case "NeedsLogin":
		s.State = "needsLogin"
		s.Message = "请登录账号，授权这台设备"
	case "NeedsMachineAuth":
		s.State = "needsApproval"
		s.Message = "请在Tailscale后台批准这台设备"
	case "Stopped":
		s.State = "paused"
		s.Message = "远程访问已暂停，登录仍保留"
	case "Starting":
		s.State = "connecting"
		s.Message = "正在连接，请稍等"
	case "Running":
		s.State = "connected"
		s.Message = "已连接，获准的设备可以访问"
	default:
		s.State = "unavailable"
		s.Message = "远程服务尚未就绪"
	}
	if doc.Self != nil && doc.Self.Expired {
		s.State = "expired"
		s.Message = "登录已过期，请重新授权"
	}
	if s.State == "needsLogin" || s.State == "expired" {
		if validAuthURL(doc.AuthURL) {
			s.AuthURL = doc.AuthURL
		}
	}
	// Tailscale health text may contain authentication links. Never return it
	// verbatim, persist it in jobs, or log command output containing such links.
	if len(doc.Health) > 0 {
		s.Health = []string{"连接存在提醒，请在官方后台查看"}
	}
	return s, nil
}

func tailIP(ip net.IP) bool {
	v := ip.To4()
	return v != nil && v[0] == 100 && v[1] >= 64 && v[1] <= 127
}
func validAuthURL(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host == "login.tailscale.com" && u.User == nil && strings.HasPrefix(u.Path, "/a/") && u.Fragment == ""
}

// Install only signed packages from the vendor and Ubuntu repositories. The
// downloaded shell installer is never executed. Existing device state stays.
const installCommand = `set -eu
test -e /dev/net/tun
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_CODENAME" = noble
fresh=0
if ! command -v tailscale >/dev/null 2>&1; then
 fresh=1
 download=$(mktemp -d)
 trap 'rm -rf "$download"' EXIT
 curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 120 -o "$download/key" https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg
 curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 120 -o "$download/list" https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list
 test -s "$download/key"
 test -s "$download/list"
 sudo -n mkdir -p /usr/share/keyrings
 sudo -n install -m 644 "$download/key" /usr/share/keyrings/tailscale-archive-keyring.gpg
 sudo -n install -m 644 "$download/list" /etc/apt/sources.list.d/tailscale.list
 sudo -n apt-get -o DPkg::Lock::Timeout=120 update
 sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y tailscale
fi
if ! command -v socat >/dev/null 2>&1; then
 sudo -n apt-get -o DPkg::Lock::Timeout=120 update
 sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y socat
fi
sudo -n systemctl enable --now tailscaled
if test "$fresh" = 1; then
 sudo -n tailscale set --accept-dns=false --accept-routes=false --hostname=macbox
fi
`

func (m *Manager) Install(ctx context.Context) error {
	if _, err := m.guest.Exec(ctx, "sh", "-c", installCommand); err != nil {
		return fmt.Errorf("安装未完成，请检查网络后重试")
	}
	return m.ensureRelay(ctx)
}

func (m *Manager) ensureRelay(ctx context.Context) error {
	if m.port < 1 || m.port > 65535 {
		return fmt.Errorf("后台端口无效")
	}
	unit := fmt.Sprintf(`# Managed by MacBox remote access
[Unit]
Description=MacBox private remote access
After=tailscaled.service network-online.target
Wants=tailscaled.service
StartLimitIntervalSec=0
[Service]
Type=simple
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_UNIX
ExecStart=/bin/sh -c 'ip=$$(/usr/bin/tailscale ip -4 2>/dev/null); case "$$ip" in 100.*) exec /usr/bin/socat TCP4-LISTEN:%d,bind=$$ip,fork,reuseaddr,keepalive TCP4:host.lima.internal:%d,keepalive ;; *) exit 1 ;; esac'
Restart=on-failure
RestartSec=5
StandardOutput=null
StandardError=null
[Install]
WantedBy=multi-user.target
`, m.port, m.port)
	// Refuse an unrelated service with the same name rather than overwriting it.
	script := `set -eu
p=/etc/systemd/system/macbox-remote-access.service
if test -e "$p"; then test ! -L "$p"; head -n 1 "$p" | grep -Fx '# Managed by MacBox remote access' >/dev/null; fi
test ! -L "$p"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
changed=0
if ! cmp -s "$tmp" "$p"; then changed=1; fi
cat "$tmp" > "$p"
chmod 644 "$p"
systemctl daemon-reload
systemctl enable --now macbox-remote-access.service
if test "$changed" = 1; then systemctl try-restart macbox-remote-access.service; fi
`
	if _, err := m.guest.ExecWithInput(ctx, strings.NewReader(unit), "sudo", "-n", "sh", "-c", script); err != nil {
		return fmt.Errorf("后台入口未就绪，请重新开启访问")
	}
	return nil
}

// Only WantRunning is changed on resume. The official local daemon API starts
// interactive login without resetting other preferences (unlike up flags).
// Responses containing preferences are discarded inside the guest.
func (m *Manager) Connect(ctx context.Context) error {
	if _, err := m.guest.Exec(ctx, "sudo", "-n", "systemctl", "start", "tailscaled"); err != nil {
		return fmt.Errorf("远程服务无法启动，请重新开启")
	}
	before, err := m.Status(ctx)
	if err != nil || !before.Installed {
		return fmt.Errorf("请先开启远程访问")
	}
	if before.State != "connected" {
		base := []string{"sudo", "-n", "curl", "--fail", "--silent", "--max-time", "10", "--output", "/dev/null", "--unix-socket", "/run/tailscale/tailscaled.sock"}
		args := append(append([]string{}, base...), "--request", "PATCH", "--header", "Content-Type: application/json", "--data", `{"WantRunning":true,"WantRunningSet":true}`, "http://local-tailscaled.sock/localapi/v0/prefs")
		if _, err := m.guest.Exec(ctx, args...); err != nil {
			return fmt.Errorf("远程连接未开始，请稍后重试")
		}
		if before.State == "needsLogin" || before.State == "expired" {
			args = append(append([]string{}, base...), "--request", "POST", "http://local-tailscaled.sock/localapi/v0/login-interactive")
			if _, err := m.guest.Exec(ctx, args...); err != nil {
				return fmt.Errorf("登录未开始，请检查网络后重试")
			}
		}
		deadline := time.NewTimer(15 * time.Second)
		defer deadline.Stop()
		for {
			after, err := m.Status(ctx)
			if err != nil {
				return err
			}
			if after.AuthURL != "" || after.State == "needsApproval" || after.State == "connected" {
				break
			}
			select {
			case <-ctx.Done():
				return fmt.Errorf("操作已中止，请刷新连接状态")
			case <-deadline.C:
				return fmt.Errorf("连接尚未就绪，请稍后重试")
			case <-time.After(500 * time.Millisecond):
			}
		}
	}
	return m.ensureRelay(ctx)
}

func (m *Manager) Pause(ctx context.Context) error {
	if _, err := m.guest.Exec(ctx, "sudo", "-n", "tailscale", "down"); err != nil {
		return fmt.Errorf("暂停失败，请稍后重试")
	}
	_, _ = m.guest.Exec(ctx, "sudo", "-n", "systemctl", "stop", "macbox-remote-access.service")
	return nil
}
func (m *Manager) Logout(ctx context.Context) error {
	if _, err := m.guest.Exec(ctx, "sudo", "-n", "tailscale", "logout"); err != nil {
		return fmt.Errorf("退出失败，请稍后重试")
	}
	_, _ = m.guest.Exec(ctx, "sudo", "-n", "systemctl", "stop", "macbox-remote-access.service")
	return nil
}
