package samba

import (
	"context"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/vm"
)

type SMBShareItem struct {
	config.SMBShare
	Address string `json:"address"` // e.g. smb://192.168.2.123:4455/MacNAS
}

type AvailableTarget struct {
	Name        string `json:"name"`        // e.g. "主硬盘 1 完整存储池 (/data)"
	Path        string `json:"path"`        // e.g. "/data"
	Source      string `json:"source"`      // "primary", "secondary", "passthrough", "custom"
	Description string `json:"description"` // e.g. "NAS 核心大容量存储池"
	Exists      bool   `json:"exists"`
}

type SambaStatus struct {
	ShareName        string            `json:"shareName"`
	Path             string            `json:"path"`
	Address          string            `json:"address"`
	User             string            `json:"user"`
	Port             int               `json:"port"`
	Status           string            `json:"status"` // "running", "stopped", "unknown"
	HasConflict      bool              `json:"hasConflict"`
	Message          string            `json:"message"`
	Shares           []SMBShareItem    `json:"shares"`
	AvailableTargets []AvailableTarget `json:"availableTargets"`
}

type Manager struct {
	cfg      *config.Config
	vmMgr    *vm.Manager
	mu       sync.Mutex
	syncOnce sync.Once
}

func NewManager(cfg *config.Config, vmMgr *vm.Manager) *Manager {
	m := &Manager{
		cfg:   cfg,
		vmMgr: vmMgr,
	}
	m.ensureDefaultShares()
	return m
}

func (m *Manager) ensureDefaultShares() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.cfg.Samba.Shares) > 0 {
		return
	}

	shares := []config.SMBShare{
		{
			ID:         "share-primary",
			Name:       "MacNAS",
			Path:       "/data",
			Comment:    "主硬盘 1 完整存储池",
			Writable:   true,
			GuestOk:    true,
			Enabled:    true,
			DiskSource: "primary",
		},
	}

	// If secondary disk or volume2-ssd mount exists, add secondary disk share
	hasSecondary := m.cfg.Storage.SecondaryDisk != "" || m.cfg.Storage.SecondaryMount != ""
	for _, lm := range m.cfg.Storage.LocalMounts {
		if lm.ID == "volume2-ssd" || lm.Category == "volume2" {
			hasSecondary = true
			break
		}
	}

	if hasSecondary {
		shares = append(shares, config.SMBShare{
			ID:         "share-secondary",
			Name:       "MacNAS-SSD2",
			Path:       "/data/volume2-ssd",
			Comment:    "第二硬盘 256GB 本机高速盘",
			Writable:   true,
			GuestOk:    true,
			Enabled:    true,
			DiskSource: "secondary",
		})
	}

	// If downloads passthrough exists
	for _, lm := range m.cfg.Storage.LocalMounts {
		if lm.ID == "mac-downloads" {
			shares = append(shares, config.SMBShare{
				ID:         "share-downloads",
				Name:       "MacDownloads",
				Path:       "/data/downloads/MacDownloads",
				Comment:    "Mac 直通下载目录",
				Writable:   true,
				GuestOk:    true,
				Enabled:    true,
				DiskSource: "passthrough",
			})
			break
		}
	}

	m.cfg.Samba.Shares = shares
	_ = config.SaveConfig(m.cfg)
}

func (m *Manager) GetStatus(ctx context.Context, hostIP string) (*SambaStatus, error) {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}

	m.ensureDefaultShares()

	m.syncOnce.Do(func() {
		go func() {
			time.Sleep(500 * time.Millisecond)
			_ = m.ApplyConfig(context.Background())
		}()
	})

	vmStat, _ := m.vmMgr.GetStatus()
	statusStr := "stopped"

	if vmStat.Status == "Running" {
		out, err := m.vmMgr.Exec(ctx, "systemctl", "is-active", "smbd")
		if err == nil && strings.TrimSpace(out) == "active" {
			statusStr = "running"
		}
	}

	port := m.cfg.Samba.Port
	if port <= 0 {
		port = 4455
	}

	defaultAddr := fmt.Sprintf("smb://%s/MacNAS", hostIP)
	if port != 445 {
		defaultAddr = fmt.Sprintf("smb://%s:%d/MacNAS", hostIP, port)
	}

	// Construct list of shares with resolved addresses
	var shareItems []SMBShareItem
	for _, s := range m.cfg.Samba.Shares {
		addr := fmt.Sprintf("smb://%s/%s", hostIP, s.Name)
		if port != 445 {
			addr = fmt.Sprintf("smb://%s:%d/%s", hostIP, port, s.Name)
		}
		shareItems = append(shareItems, SMBShareItem{
			SMBShare: s,
			Address:  addr,
		})
	}

	return &SambaStatus{
		ShareName:        m.cfg.Samba.ShareName,
		Path:             "/data",
		Address:          defaultAddr,
		User:             m.cfg.Samba.User,
		Port:             port,
		Status:           statusStr,
		HasConflict:      false,
		Message:          "Samba 服务已配置并映射至局域网",
		Shares:           shareItems,
		AvailableTargets: m.GetAvailableTargets(ctx),
	}, nil
}

func (m *Manager) GetAvailableTargets(ctx context.Context) []AvailableTarget {
	targets := []AvailableTarget{
		{
			Name:        "主硬盘 1 完整存储池 (/data)",
			Path:        "/data",
			Source:      "primary",
			Description: "主存储池全盘共享，含所有已安装应用与子目录",
			Exists:      true,
		},
	}

	// Check for secondary disk
	hasSecondary := m.cfg.Storage.SecondaryDisk != "" || m.cfg.Storage.SecondaryMount != ""
	for _, lm := range m.cfg.Storage.LocalMounts {
		if lm.ID == "volume2-ssd" || lm.Category == "volume2" {
			hasSecondary = true
			break
		}
	}
	if hasSecondary {
		targets = append(targets, AvailableTarget{
			Name:        "第二硬盘 256GB 本机高速盘 (/data/volume2-ssd)",
			Path:        "/data/volume2-ssd",
			Source:      "secondary",
			Description: "Mac 本机 256GB 高速固态盘挂载点，适合高速传输",
			Exists:      true,
		})
	}

	// Local mounts
	for _, lm := range m.cfg.Storage.LocalMounts {
		if lm.ID == "volume2-ssd" {
			continue
		}
		targetPath := "/data/" + strings.TrimPrefix(lm.GuestTarget, "/")
		targets = append(targets, AvailableTarget{
			Name:        fmt.Sprintf("%s (%s)", lm.Name, targetPath),
			Path:        targetPath,
			Source:      "passthrough",
			Description: lm.Description,
			Exists:      lm.Enabled,
		})
	}

	// Custom common dirs
	targets = append(targets,
		AvailableTarget{
			Name:        "媒体库目录 (/data/media)",
			Path:        "/data/media",
			Source:      "custom",
			Description: "Jellyfin / 影视影视共享专区",
			Exists:      true,
		},
		AvailableTarget{
			Name:        "离线下载目录 (/data/downloads)",
			Path:        "/data/downloads",
			Source:      "custom",
			Description: "BT / 磁力 / 浏览器下载集中区",
			Exists:      true,
		},
		AvailableTarget{
			Name:        "安全备份空间 (/data/backup)",
			Path:        "/data/backup",
			Source:      "custom",
			Description: "客户端 Time Machine 或备份数据存放区",
			Exists:      true,
		},
	)

	return targets
}

func (m *Manager) ApplyConfig(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var sb strings.Builder
	sb.WriteString("[global]\n")
	sb.WriteString("   workgroup = WORKGROUP\n")
	sb.WriteString("   server string = MacNAS\n")
	sb.WriteString("   server role = standalone server\n")
	sb.WriteString("   security = user\n")
	sb.WriteString("   map to guest = Bad User\n")
	sb.WriteString("   dns proxy = no\n")
	sb.WriteString("   log file = /var/log/samba/log.%m\n")
	sb.WriteString("   max log size = 50\n\n")

	var dirsToCreate []string

	for _, s := range m.cfg.Samba.Shares {
		if !s.Enabled {
			continue
		}

		cleanName := strings.TrimSpace(s.Name)
		if cleanName == "" {
			continue
		}

		cleanPath := strings.TrimSpace(s.Path)
		if cleanPath == "" {
			cleanPath = "/data"
		}
		dirsToCreate = append(dirsToCreate, cleanPath)

		sb.WriteString(fmt.Sprintf("[%s]\n", cleanName))
		if s.Comment != "" {
			sb.WriteString(fmt.Sprintf("   comment = %s\n", s.Comment))
		} else {
			sb.WriteString(fmt.Sprintf("   comment = MacNAS Share %s\n", cleanName))
		}
		sb.WriteString(fmt.Sprintf("   path = %s\n", cleanPath))
		sb.WriteString("   browseable = yes\n")

		if s.Writable {
			sb.WriteString("   writable = yes\n")
			sb.WriteString("   read only = no\n")
		} else {
			sb.WriteString("   writable = no\n")
			sb.WriteString("   read only = yes\n")
		}

		if s.GuestOk {
			sb.WriteString("   guest ok = yes\n")
		} else {
			sb.WriteString("   guest ok = no\n")
		}

		sb.WriteString("   create mask = 0777\n")
		sb.WriteString("   directory mask = 0777\n")
		sb.WriteString("   force user = root\n\n")
	}

	confContent := sb.String()
	encoded := base64.StdEncoding.EncodeToString([]byte(confContent))

	// 1. Ensure target dirs exist
	if len(dirsToCreate) > 0 {
		var mkdirCmds []string
		for _, d := range dirsToCreate {
			mkdirCmds = append(mkdirCmds, fmt.Sprintf("mkdir -p '%s'", d))
		}
		_, _ = m.vmMgr.Exec(ctx, "sudo", "bash", "-c", strings.Join(mkdirCmds, " && "))
	}

	// 2. Write /etc/samba/smb.conf
	writeCmd := fmt.Sprintf("echo '%s' | base64 -d | sudo tee /etc/samba/smb.conf > /dev/null", encoded)
	if out, err := m.vmMgr.Exec(ctx, "bash", "-c", writeCmd); err != nil {
		return fmt.Errorf("写入 smb.conf 失败: %s (%w)", out, err)
	}

	// 3. Reload or restart Samba
	reloadCmd := "sudo systemctl reload smbd || sudo systemctl restart smbd"
	if out, err := m.vmMgr.Exec(ctx, "bash", "-c", reloadCmd); err != nil {
		return fmt.Errorf("重载 Samba 服务失败: %s (%w)", out, err)
	}

	return nil
}

var shareNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_\-]+$`)

func (m *Manager) AddOrUpdateShare(ctx context.Context, share config.SMBShare) (*config.SMBShare, error) {
	share.Name = strings.TrimSpace(share.Name)
	if share.Name == "" {
		return nil, fmt.Errorf("共享服务名称不能为空")
	}
	if !shareNameRegex.MatchString(share.Name) {
		return nil, fmt.Errorf("共享名称仅支持英文字母、数字、下划线及连字符 (-)")
	}

	share.Path = strings.TrimSpace(share.Path)
	if share.Path == "" {
		return nil, fmt.Errorf("共享目录路径不能为空")
	}
	if !strings.HasPrefix(share.Path, "/") {
		return nil, fmt.Errorf("共享目录必须为绝对路径 (以 / 开头)")
	}

	m.mu.Lock()
	if share.ID == "" {
		share.ID = fmt.Sprintf("share-%d", time.Now().UnixNano())
	}

	// Check if updating existing or inserting
	foundIndex := -1
	for i, s := range m.cfg.Samba.Shares {
		if s.ID == share.ID {
			foundIndex = i
			break
		}
	}

	// Check duplicate name on other shares
	for i, s := range m.cfg.Samba.Shares {
		if s.Name == share.Name && i != foundIndex {
			m.mu.Unlock()
			return nil, fmt.Errorf("共享服务名称 '%s' 已被其他共享项占用，请使用其他名称", share.Name)
		}
	}

	if foundIndex >= 0 {
		m.cfg.Samba.Shares[foundIndex] = share
	} else {
		m.cfg.Samba.Shares = append(m.cfg.Samba.Shares, share)
	}

	_ = config.SaveConfig(m.cfg)
	m.mu.Unlock()

	if err := m.ApplyConfig(ctx); err != nil {
		return nil, err
	}

	return &share, nil
}

func (m *Manager) ToggleShare(ctx context.Context, id string) (bool, error) {
	m.mu.Lock()
	found := false
	var newState bool
	for i, s := range m.cfg.Samba.Shares {
		if s.ID == id {
			m.cfg.Samba.Shares[i].Enabled = !s.Enabled
			newState = m.cfg.Samba.Shares[i].Enabled
			found = true
			break
		}
	}
	if !found {
		m.mu.Unlock()
		return false, fmt.Errorf("未找到 ID 为 %s 的共享项", id)
	}
	_ = config.SaveConfig(m.cfg)
	m.mu.Unlock()

	if err := m.ApplyConfig(ctx); err != nil {
		return newState, err
	}
	return newState, nil
}

func (m *Manager) DeleteShare(ctx context.Context, id string) error {
	m.mu.Lock()
	var newShares []config.SMBShare
	found := false
	for _, s := range m.cfg.Samba.Shares {
		if s.ID == id {
			found = true
			continue
		}
		newShares = append(newShares, s)
	}
	if !found {
		m.mu.Unlock()
		return fmt.Errorf("未找到 ID 为 %s 的共享项", id)
	}

	m.cfg.Samba.Shares = newShares
	_ = config.SaveConfig(m.cfg)
	m.mu.Unlock()

	return m.ApplyConfig(ctx)
}

func (m *Manager) ToggleService(ctx context.Context, enable bool) error {
	action := "stop"
	if enable {
		action = "start"
	}
	out, err := m.vmMgr.Exec(ctx, "sudo", "systemctl", action, "smbd", "nmbd")
	if err != nil {
		return fmt.Errorf("%s Samba 失败: %s (%w)", action, out, err)
	}
	return nil
}

func (m *Manager) UpdatePassword(ctx context.Context, newPassword string) error {
	if newPassword == "" {
		return fmt.Errorf("密码不能为空")
	}

	cmd := fmt.Sprintf("(echo '%s'; echo '%s') | smbpasswd -a macnas -s && smbpasswd -e macnas", newPassword, newPassword)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", cmd)
	if err != nil {
		return fmt.Errorf("修改密码失败: %s (%w)", out, err)
	}

	m.cfg.Samba.Password = newPassword
	return config.SaveConfig(m.cfg)
}

func (m *Manager) EnsurePassword(ctx context.Context) error {
	pwd := m.cfg.Samba.Password
	if pwd == "" {
		pwd = "macnas"
	}
	cmd := fmt.Sprintf("id -u macnas &>/dev/null || useradd -M -s /usr/sbin/nologin macnas; (echo '%s'; echo '%s') | smbpasswd -a macnas -s && smbpasswd -e macnas", pwd, pwd)
	_, err := m.vmMgr.Exec(ctx, "sudo", "bash", "-c", cmd)
	return err
}

func (m *Manager) Restart(ctx context.Context) error {
	_ = m.ApplyConfig(ctx)
	out, err := m.vmMgr.Exec(ctx, "sudo", "systemctl", "restart", "smbd", "nmbd")
	if err != nil {
		return fmt.Errorf("重启 Samba 失败: %s (%w)", out, err)
	}
	return nil
}
