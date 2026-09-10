package system

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/luluen/mac-nas/pkg/vm"
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
	if vmStatus, err := sm.vmMgr.GetStatus(); err == nil && vmStatus != nil {
		cfg.SSHLocalPort = vmStatus.SSHLocalPort
	}

	// 2. Check service status
	statusOut, _ := sm.vmMgr.Exec(ctx, "bash", "-c", "sudo systemctl is-active ssh 2>/dev/null || sudo systemctl is-active sshd 2>/dev/null")
	if strings.TrimSpace(statusOut) == "active" {
		cfg.Enabled = true
		cfg.Status = "running"
	} else {
		cfg.Enabled = false
		cfg.Status = "stopped"
	}

	// 3. Read 99-macnas.conf if exists
	confOut, err := sm.vmMgr.Exec(ctx, "bash", "-c", "sudo cat /etc/ssh/sshd_config.d/99-macnas.conf 2>/dev/null")
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
		defOut, _ := sm.vmMgr.Exec(ctx, "bash", "-c", "sudo grep -E '^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port)' /etc/ssh/sshd_config 2>/dev/null")
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
	keysOut, _ := sm.vmMgr.Exec(ctx, "bash", "-c", "sudo cat /root/.ssh/authorized_keys 2>/dev/null")
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

	encoded := base64.StdEncoding.EncodeToString([]byte(confContent))
	writeCmd := fmt.Sprintf("echo '%s' | base64 -d | sudo tee /etc/ssh/sshd_config.d/99-macnas.conf >/dev/null", encoded)

	if out, err := sm.vmMgr.Exec(ctx, "bash", "-c", writeCmd); err != nil {
		return fmt.Errorf("写入 SSH 配置失败: %s (%w)", out, err)
	}

	// Restart or reload ssh service
	restartCmd := "sudo systemctl restart ssh 2>/dev/null || sudo systemctl restart sshd 2>/dev/null"
	if out, err := sm.vmMgr.Exec(ctx, "bash", "-c", restartCmd); err != nil {
		return fmt.Errorf("重启 SSH 服务失败: %s (%w)", out, err)
	}

	return nil
}

// ToggleService starts or stops the SSH service
func (sm *SSHManager) ToggleService(ctx context.Context, enable bool) error {
	var cmd string
	if enable {
		cmd = "sudo systemctl unmask ssh 2>/dev/null; sudo systemctl start ssh 2>/dev/null || sudo systemctl start sshd 2>/dev/null"
	} else {
		cmd = "sudo systemctl stop ssh 2>/dev/null || sudo systemctl stop sshd 2>/dev/null"
	}

	if out, err := sm.vmMgr.Exec(ctx, "bash", "-c", cmd); err != nil {
		return fmt.Errorf("控制 SSH 服务状态失败: %s (%w)", out, err)
	}

	return nil
}

// GenerateRootKey generates an ED25519 keypair inside the VM, appends the public key to /root/.ssh/authorized_keys,
// ensures SSH config enables Root login and Pubkey authentication, and returns the private key for downloading.
func (sm *SSHManager) GenerateRootKey(ctx context.Context, comment string) (*SSHKeyGenerationResult, error) {
	if strings.TrimSpace(comment) == "" {
		comment = fmt.Sprintf("macnas-root-%s", time.Now().Format("20060102-150405"))
	}

	keyPath := fmt.Sprintf("/tmp/macnas_root_key_%d", time.Now().UnixNano())

	// 1. Generate ED25519 keypair in VM
	genCmd := fmt.Sprintf("ssh-keygen -t ed25519 -N '' -C '%s' -f %s", comment, keyPath)
	if out, err := sm.vmMgr.Exec(ctx, "bash", "-c", genCmd); err != nil {
		return nil, fmt.Errorf("生成 ED25519 密钥对失败: %s (%w)", out, err)
	}

	// 2. Read private key, public key, and fingerprint
	readCmd := fmt.Sprintf("cat %s && echo '---DIVIDER---' && cat %s.pub && echo '---DIVIDER---' && ssh-keygen -lf %s.pub", keyPath, keyPath, keyPath)
	contentOut, err := sm.vmMgr.Exec(ctx, "bash", "-c", readCmd)
	if err != nil {
		// Clean up
		_, _ = sm.vmMgr.Exec(ctx, "bash", "-c", fmt.Sprintf("rm -f %s %s.pub", keyPath, keyPath))
		return nil, fmt.Errorf("读取生成密钥失败: %s (%w)", contentOut, err)
	}

	parts := strings.Split(contentOut, "---DIVIDER---")
	if len(parts) < 3 {
		_, _ = sm.vmMgr.Exec(ctx, "bash", "-c", fmt.Sprintf("rm -f %s %s.pub", keyPath, keyPath))
		return nil, fmt.Errorf("解析生成密钥失败: 输出格式不符合预期")
	}

	privKey := strings.TrimSpace(parts[0])
	pubKey := strings.TrimSpace(parts[1])
	fpOutput := strings.TrimSpace(parts[2])

	fingerprint := ""
	fpFields := strings.Fields(fpOutput)
	if len(fpFields) >= 2 {
		fingerprint = fpFields[1]
	} else {
		fingerprint = fpOutput
	}

	// 3. Append public key to /root/.ssh/authorized_keys
	installCmd := fmt.Sprintf("sudo mkdir -p /root/.ssh && sudo chmod 700 /root/.ssh && echo '%s' | sudo tee -a /root/.ssh/authorized_keys >/dev/null && sudo chmod 600 /root/.ssh/authorized_keys", pubKey)
	if out, err := sm.vmMgr.Exec(ctx, "bash", "-c", installCmd); err != nil {
		_, _ = sm.vmMgr.Exec(ctx, "bash", "-c", fmt.Sprintf("rm -f %s %s.pub", keyPath, keyPath))
		return nil, fmt.Errorf("将公钥安装到 root authorized_keys 失败: %s (%w)", out, err)
	}

	// 4. Clean up temporary files inside VM
	_, _ = sm.vmMgr.Exec(ctx, "bash", "-c", fmt.Sprintf("rm -f %s %s.pub", keyPath, keyPath))

	// 5. Ensure SSH config has PermitRootLogin=yes and PubkeyAuthentication=yes
	cfg, _ := sm.GetConfig(ctx)
	if cfg == nil {
		cfg = &SSHConfig{Port: 22, PasswordAuthentication: true}
	}
	cfg.PermitRootLogin = true
	cfg.PubkeyAuthentication = true
	if err := sm.UpdateConfig(ctx, *cfg); err != nil {
		fmt.Printf("警告: 自动更新 SSH PermitRootLogin 配置失败: %v\n", err)
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
	out, err := sm.vmMgr.Exec(ctx, "bash", "-c", "sudo cat /root/.ssh/authorized_keys 2>/dev/null")
	if err != nil {
		return []string{}, nil
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
	pubKey = strings.TrimSpace(pubKey)
	if pubKey == "" {
		return fmt.Errorf("公钥内容不能为空")
	}

	if !strings.HasPrefix(pubKey, "ssh-") && !strings.HasPrefix(pubKey, "ecdsa-") {
		return fmt.Errorf("无效的 SSH 公钥格式 (应以 ssh-ed25519, ssh-rsa, ecdsa-... 开头)")
	}

	installCmd := fmt.Sprintf("sudo mkdir -p /root/.ssh && sudo chmod 700 /root/.ssh && echo '%s' | sudo tee -a /root/.ssh/authorized_keys >/dev/null && sudo chmod 600 /root/.ssh/authorized_keys", pubKey)
	if out, err := sm.vmMgr.Exec(ctx, "bash", "-c", installCmd); err != nil {
		return fmt.Errorf("添加公钥失败: %s (%w)", out, err)
	}

	// Ensure PermitRootLogin=yes & PubkeyAuthentication=yes
	cfg, _ := sm.GetConfig(ctx)
	if cfg != nil {
		cfg.PermitRootLogin = true
		cfg.PubkeyAuthentication = true
		_ = sm.UpdateConfig(ctx, *cfg)
	}

	return nil
}

// ClearRootAuthorizedKeys removes all keys from /root/.ssh/authorized_keys
func (sm *SSHManager) ClearRootAuthorizedKeys(ctx context.Context) error {
	cmd := "sudo mkdir -p /root/.ssh && sudo truncate -s 0 /root/.ssh/authorized_keys 2>/dev/null && sudo chmod 600 /root/.ssh/authorized_keys"
	if out, err := sm.vmMgr.Exec(ctx, "bash", "-c", cmd); err != nil {
		return fmt.Errorf("清空公钥失败: %s (%w)", out, err)
	}
	return nil
}
