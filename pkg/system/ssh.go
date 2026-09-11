package system

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/luluen/mac-nas/pkg/vm"
	"golang.org/x/crypto/ssh"
)

type SSHConfig struct {
	Enabled                bool   `json:"enabled"`
	Status                 string `json:"status"` // "running" | "stopped"
	Port                   int    `json:"port"`
	SSHLocalPort           int    `json:"sshLocalPort"`
	PermitRootLogin        bool   `json:"permitRootLogin"`
	PasswordAuthentication bool   `json:"passwordAuthentication"`
	PubkeyAuthentication   bool   `json:"pubkeyAuthentication"`
	AuthorizedKeyCount     int    `json:"authorizedKeyCount"`
}

type SSHKeyGenerationResult struct {
	PrivateKey  string `json:"privateKey"`
	PublicKey   string `json:"publicKey"`
	KeyType     string `json:"keyType"`     // "ed25519"
	Fingerprint string `json:"fingerprint"` // e.g. "SHA256:..."
	Comment     string `json:"comment"`
	Filename    string `json:"filename"` // "macnas_root_id_ed25519"
}

type SSHManager struct {
	vmMgr *vm.Manager
}

func hasSSHControlChars(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func normalizeAuthorizedKey(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len([]byte(raw)) > 16<<10 || strings.ContainsAny(raw, "\r\n") {
		return "", fmt.Errorf("SSH 公钥必须是单行且不能超过 16 KB")
	}
	key, _, _, rest, err := ssh.ParseAuthorizedKey([]byte(raw))
	if err != nil || key == nil || strings.TrimSpace(string(rest)) != "" {
		return "", fmt.Errorf("SSH 公钥格式无效")
	}
	return raw, nil
}

func NewSSHManager(vmMgr *vm.Manager) *SSHManager {
	return &SSHManager{
		vmMgr: vmMgr,
	}
}

// GetConfig reads the active SSH configuration, service status, and authorized key counts
func (sm *SSHManager) GetConfig(ctx context.Context) (*SSHConfig, error) {
	cfg := &SSHConfig{
		Enabled:                true,
		Status:                 "stopped",
		Port:                   22,
		SSHLocalPort:           0,
		PermitRootLogin:        false,
		PasswordAuthentication: true,
		PubkeyAuthentication:   true,
		AuthorizedKeyCount:     0,
	}

	// 1. Get SSHLocalPort from VM manager status
	if vmStatus, err := sm.vmMgr.GetStatusContext(ctx); err == nil && vmStatus != nil {
		cfg.SSHLocalPort = vmStatus.SSHLocalPort
	}

	// 2. Check service status
	statusOut, statusErr := sm.vmMgr.Exec(ctx, "sudo", "systemctl", "is-active", "ssh")
	if statusErr != nil {
		statusOut, _ = sm.vmMgr.Exec(ctx, "sudo", "systemctl", "is-active", "sshd")
	}
	if strings.TrimSpace(statusOut) == "active" {
		cfg.Enabled = true
		cfg.Status = "running"
	} else {
		cfg.Enabled = false
		cfg.Status = "stopped"
	}

	// 3. Read 99-macnas.conf if exists
	confOut, err := sm.vmMgr.Exec(ctx, "sudo", "cat", "/etc/ssh/sshd_config.d/99-macnas.conf")
	if err == nil && strings.TrimSpace(confOut) != "" {
		lines := strings.Split(confOut, "\n")
		for _, l := range lines {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "#") || l == "" {
				continue
			}
			parts := strings.Fields(l)
			if len(parts) >= 2 {
				key := strings.ToLower(parts[0])
				val := strings.ToLower(parts[1])
				switch key {
				case "port":
					if p, err := strconv.Atoi(val); err == nil && p > 0 {
						cfg.Port = p
					}
				case "permitrootlogin":
					cfg.PermitRootLogin = (val == "yes")
				case "passwordauthentication":
					cfg.PasswordAuthentication = (val == "yes")
				case "pubkeyauthentication":
					cfg.PubkeyAuthentication = (val == "yes")
				}
			}
		}
	} else {
		// Fallback check standard sshd_config
		defOut, _ := sm.vmMgr.Exec(ctx, "sudo", "grep", "-E", "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port)", "/etc/ssh/sshd_config")
		for _, l := range strings.Split(defOut, "\n") {
			parts := strings.Fields(strings.TrimSpace(l))
			if len(parts) >= 2 {
				key := strings.ToLower(parts[0])
				val := strings.ToLower(parts[1])
				switch key {
				case "permitrootlogin":
					cfg.PermitRootLogin = (val == "yes")
				case "passwordauthentication":
					cfg.PasswordAuthentication = (val == "yes")
				case "pubkeyauthentication":
					cfg.PubkeyAuthentication = (val == "yes")
				case "port":
					if p, err := strconv.Atoi(val); err == nil && p > 0 {
						cfg.Port = p
					}
				}
			}
		}
	}

	// 4. Count root authorized keys
	keysOut, _ := sm.vmMgr.Exec(ctx, "sudo", "cat", "/root/.ssh/authorized_keys")
	keyCount := 0
	for _, l := range strings.Split(keysOut, "\n") {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, "#") {
			keyCount++
		}
	}
	cfg.AuthorizedKeyCount = keyCount

	return cfg, nil
}

// UpdateConfig updates the SSH configuration via /etc/ssh/sshd_config.d/99-macnas.conf
func (sm *SSHManager) UpdateConfig(ctx context.Context, newCfg SSHConfig) error {
	if newCfg.Port <= 0 || newCfg.Port > 65535 {
		newCfg.Port = 22
	}

	permitRoot := "no"
	if newCfg.PermitRootLogin {
		permitRoot = "yes"
	}

	passwordAuth := "no"
	if newCfg.PasswordAuthentication {
		passwordAuth = "yes"
	}

	pubkeyAuth := "no"
	if newCfg.PubkeyAuthentication {
		pubkeyAuth = "yes"
	}

	confContent := fmt.Sprintf(`# MacNAS Managed SSH Configuration
Port %d
PermitRootLogin %s
PasswordAuthentication %s
PubkeyAuthentication %s
AuthorizedKeysFile .ssh/authorized_keys .ssh/authorized_keys2
`, newCfg.Port, permitRoot, passwordAuth, pubkeyAuth)

	if out, err := sm.vmMgr.ExecWithInput(ctx, strings.NewReader(confContent), "sudo", "tee", "/etc/ssh/sshd_config.d/99-macnas.conf"); err != nil {
		return fmt.Errorf("写入 SSH 配置失败: %s (%w)", out, err)
	}

	// Restart or reload ssh service
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "systemctl", "restart", "ssh"); err != nil {
		if restartOut, restartErr := sm.vmMgr.Exec(ctx, "sudo", "systemctl", "restart", "sshd"); restartErr != nil {
			return fmt.Errorf("重启 SSH 服务失败: %s; sshd 重启失败: %s (%w)", out, restartOut, restartErr)
		}
	}

	return nil
}

// ToggleService starts or stops the SSH service
func (sm *SSHManager) ToggleService(ctx context.Context, enable bool) error {
	if enable {
		_, _ = sm.vmMgr.Exec(ctx, "sudo", "systemctl", "unmask", "ssh")
		if out, err := sm.vmMgr.Exec(ctx, "sudo", "systemctl", "start", "ssh"); err != nil {
			if fallbackOut, fallbackErr := sm.vmMgr.Exec(ctx, "sudo", "systemctl", "start", "sshd"); fallbackErr != nil {
				return fmt.Errorf("控制 SSH 服务状态失败: %s; sshd 启动失败: %s (%w)", out, fallbackOut, fallbackErr)
			}
		}
		return nil
	}
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "systemctl", "stop", "ssh"); err != nil {
		if fallbackOut, fallbackErr := sm.vmMgr.Exec(ctx, "sudo", "systemctl", "stop", "sshd"); fallbackErr != nil {
			return fmt.Errorf("控制 SSH 服务状态失败: %s; sshd 停止失败: %s (%w)", out, fallbackOut, fallbackErr)
		}
	}
	return nil
}

// GenerateRootKey generates an ED25519 keypair inside the VM, appends the public key to /root/.ssh/authorized_keys,
// ensures SSH config enables Root login and Pubkey authentication, and returns the private key for downloading.
func (sm *SSHManager) GenerateRootKey(ctx context.Context, comment string) (*SSHKeyGenerationResult, error) {
	if strings.TrimSpace(comment) == "" {
		comment = fmt.Sprintf("macnas-root-%s", time.Now().Format("20060102-150405"))
	}
	if hasSSHControlChars(comment) || len(comment) > 256 {
		return nil, fmt.Errorf("SSH 密钥备注格式无效")
	}

	keyPath := fmt.Sprintf("/tmp/macnas_root_key_%d", time.Now().UnixNano())

	// 1. Generate ED25519 keypair in VM
	if out, err := sm.vmMgr.Exec(ctx, "ssh-keygen", "-t", "ed25519", "-N", "", "-C", comment, "-f", keyPath); err != nil {
		return nil, fmt.Errorf("生成 ED25519 密钥对失败: %s (%w)", out, err)
	}

	// 2. Read private key, public key, and fingerprint
	privKey, privErr := sm.vmMgr.Exec(ctx, "cat", keyPath)
	pubKey, pubErr := sm.vmMgr.Exec(ctx, "cat", keyPath+".pub")
	fpOutput, fpErr := sm.vmMgr.Exec(ctx, "ssh-keygen", "-lf", keyPath+".pub")
	if privErr != nil || pubErr != nil || fpErr != nil {
		// Clean up
		_, _ = sm.vmMgr.Exec(ctx, "rm", "-f", keyPath, keyPath+".pub")
		if privErr != nil {
			return nil, fmt.Errorf("读取生成私钥失败: %w", privErr)
		}
		if pubErr != nil {
			return nil, fmt.Errorf("读取生成公钥失败: %w", pubErr)
		}
		return nil, fmt.Errorf("读取生成密钥指纹失败: %w", fpErr)
	}
	privKey = strings.TrimSpace(privKey)
	pubKey = strings.TrimSpace(pubKey)
	fpOutput = strings.TrimSpace(fpOutput)

	fingerprint := ""
	fpFields := strings.Fields(fpOutput)
	if len(fpFields) >= 2 {
		fingerprint = fpFields[1]
	} else {
		fingerprint = fpOutput
	}

	// 3. Append public key to /root/.ssh/authorized_keys
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "mkdir", "-p", "/root/.ssh"); err != nil {
		_, _ = sm.vmMgr.Exec(ctx, "rm", "-f", keyPath, keyPath+".pub")
		return nil, fmt.Errorf("准备 root authorized_keys 目录失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "chmod", "700", "/root/.ssh"); err != nil {
		_, _ = sm.vmMgr.Exec(ctx, "rm", "-f", keyPath, keyPath+".pub")
		return nil, fmt.Errorf("设置 root SSH 目录权限失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.ExecWithInput(ctx, strings.NewReader(pubKey+"\n"), "sudo", "tee", "-a", "/root/.ssh/authorized_keys"); err != nil {
		_, _ = sm.vmMgr.Exec(ctx, "rm", "-f", keyPath, keyPath+".pub")
		return nil, fmt.Errorf("将公钥安装到 root authorized_keys 失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "chmod", "600", "/root/.ssh/authorized_keys"); err != nil {
		_, _ = sm.vmMgr.Exec(ctx, "rm", "-f", keyPath, keyPath+".pub")
		return nil, fmt.Errorf("设置 root authorized_keys 权限失败: %s (%w)", out, err)
	}

	// 4. Clean up temporary files inside VM
	_, _ = sm.vmMgr.Exec(ctx, "rm", "-f", keyPath, keyPath+".pub")

	// 5. Ensure SSH config has PermitRootLogin=yes and PubkeyAuthentication=yes
	cfg, err := sm.GetConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("读取 SSH 配置失败: %w", err)
	}
	if cfg == nil {
		cfg = &SSHConfig{Port: 22, PasswordAuthentication: true}
	}
	cfg.PermitRootLogin = true
	cfg.PubkeyAuthentication = true
	if err := sm.UpdateConfig(ctx, *cfg); err != nil {
		return nil, fmt.Errorf("自动更新 SSH root 登录配置失败: %w", err)
	}

	return &SSHKeyGenerationResult{
		PrivateKey:  privKey,
		PublicKey:   pubKey,
		KeyType:     "ed25519",
		Fingerprint: fingerprint,
		Comment:     comment,
		Filename:    "macnas_root_id_ed25519",
	}, nil
}

// GetRootAuthorizedKeys lists public keys from /root/.ssh/authorized_keys
func (sm *SSHManager) GetRootAuthorizedKeys(ctx context.Context) ([]string, error) {
	out, err := sm.vmMgr.Exec(ctx, "sudo", "cat", "/root/.ssh/authorized_keys")
	if err != nil {
		return nil, fmt.Errorf("读取 root authorized_keys 失败: %w", err)
	}

	var keys []string
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, "#") {
			keys = append(keys, l)
		}
	}
	return keys, nil
}

// AddRootAuthorizedKey adds an existing public key to /root/.ssh/authorized_keys
func (sm *SSHManager) AddRootAuthorizedKey(ctx context.Context, pubKey string) error {
	var err error
	pubKey, err = normalizeAuthorizedKey(pubKey)
	if err != nil {
		return err
	}

	if out, err := sm.vmMgr.Exec(ctx, "sudo", "mkdir", "-p", "/root/.ssh"); err != nil {
		return fmt.Errorf("准备 root authorized_keys 目录失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "chmod", "700", "/root/.ssh"); err != nil {
		return fmt.Errorf("设置 root SSH 目录权限失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.ExecWithInput(ctx, strings.NewReader(pubKey+"\n"), "sudo", "tee", "-a", "/root/.ssh/authorized_keys"); err != nil {
		return fmt.Errorf("添加公钥失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "chmod", "600", "/root/.ssh/authorized_keys"); err != nil {
		return fmt.Errorf("设置 root authorized_keys 权限失败: %s (%w)", out, err)
	}

	// Ensure PermitRootLogin=yes & PubkeyAuthentication=yes
	cfg, err := sm.GetConfig(ctx)
	if err != nil {
		return fmt.Errorf("读取 SSH 配置失败: %w", err)
	}
	if cfg != nil {
		cfg.PermitRootLogin = true
		cfg.PubkeyAuthentication = true
		if err := sm.UpdateConfig(ctx, *cfg); err != nil {
			return fmt.Errorf("自动更新 SSH root 登录配置失败: %w", err)
		}
	}

	return nil
}

// ClearRootAuthorizedKeys removes all keys from /root/.ssh/authorized_keys
func (sm *SSHManager) ClearRootAuthorizedKeys(ctx context.Context) error {
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "mkdir", "-p", "/root/.ssh"); err != nil {
		return fmt.Errorf("清空公钥失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "truncate", "-s", "0", "/root/.ssh/authorized_keys"); err != nil {
		return fmt.Errorf("清空公钥失败: %s (%w)", out, err)
	}
	if out, err := sm.vmMgr.Exec(ctx, "sudo", "chmod", "600", "/root/.ssh/authorized_keys"); err != nil {
		return fmt.Errorf("清空公钥失败: %s (%w)", out, err)
	}
	return nil
}
