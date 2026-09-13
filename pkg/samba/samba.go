package samba

import (
	"context"
	"fmt"
	"log"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/vm"
)

type SMBShareItem struct {
	config.SMBShare
	Address string `json:"address"` // e.g. smb://192.168.2.123:4455/MacBox
}

type AvailableTarget struct {
	Name        string `json:"name"`        // e.g. "主硬盘 1 完整存储池 (/data)"
	Path        string `json:"path"`        // e.g. "/data"
	Source      string `json:"source"`      // "primary", "secondary", "passthrough", "custom"
	Description string `json:"description"` // e.g. "MacBox 核心大容量存储池"
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
	cfg                *config.Config
	vmMgr              *vm.Manager
	mu                 sync.Mutex
	credentialUser     string
	credentialPassword string
}

const (
	sambaInternalUser    = "macbox"
	sambaUsernameMapPath = "/etc/samba/macbox-users.map"
)

func (m *Manager) internalUser() string {
	return sambaInternalUser
}

func (m *Manager) usernameMapPath() string {
	return sambaUsernameMapPath
}

func NewManager(cfg *config.Config, vmMgr *vm.Manager) *Manager {
	m := &Manager{
		cfg:   cfg,
		vmMgr: vmMgr,
	}
	if err := m.ensureDefaultShares(); err != nil {
		log.Printf("[MacBox Samba] 保存默认共享配置失败: %v", err)
	}
	return m
}

func (m *Manager) ensureDefaultShares() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取 Samba 配置失败: %w", err)
	}
	if len(cfgSnapshot.Samba.Shares) > 0 {
		return nil
	}

	shares := []config.SMBShare{
		{
			ID:         "share-primary",
			Name:       "MacBox",
			Path:       "/data",
			Comment:    "主硬盘 1 完整存储池",
			Writable:   true,
			GuestOk:    false,
			Enabled:    true,
			DiskSource: "primary",
		},
	}

	// If secondary disk or volume2-ssd mount exists, add secondary disk share
	hasSecondary := cfgSnapshot.Storage.SecondaryDisk != "" || cfgSnapshot.Storage.SecondaryMount != ""
	for _, lm := range cfgSnapshot.Storage.LocalMounts {
		if lm.ID == "volume2-ssd" || lm.Category == "volume2" {
			hasSecondary = true
			break
		}
	}

	if hasSecondary {
		shares = append(shares, config.SMBShare{
			ID:         "share-secondary",
			Name:       "MacBox-SSD2",
			Path:       "/data/volume2-ssd",
			Comment:    "第二硬盘 256GB 本机高速盘",
			Writable:   true,
			GuestOk:    false,
			Enabled:    true,
			DiskSource: "secondary",
		})
	}

	// If downloads passthrough exists
	for _, lm := range cfgSnapshot.Storage.LocalMounts {
		if lm.ID == "mac-downloads" {
			shares = append(shares, config.SMBShare{
				ID:         "share-downloads",
				Name:       "MacDownloads",
				Path:       "/data/downloads/MacDownloads",
				Comment:    "Mac 直通下载目录",
				Writable:   true,
				GuestOk:    false,
				Enabled:    true,
				DiskSource: "passthrough",
			})
			break
		}
	}

	if err := config.Update(m.cfg, func(updated *config.Config) error {
		updated.Samba.Shares = shares
		return nil
	}); err != nil {
		return err
	}
	return nil
}

func (m *Manager) GetStatus(ctx context.Context, hostIP string) (*SambaStatus, error) {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}

	vmStat, _ := m.vmMgr.GetStatusContext(ctx)
	statusStr := "stopped"

	if vmStat != nil && vmStat.Status == "Running" {
		out, err := m.vmMgr.Exec(ctx, "systemctl", "is-active", "smbd")
		if err == nil && strings.TrimSpace(out) == "active" {
			statusStr = "running"
		}
	}

	m.mu.Lock()
	cfgSnapshot, err := config.Snapshot(m.cfg)
	m.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("读取 Samba 配置失败: %w", err)
	}
	shareName := cfgSnapshot.Samba.ShareName
	user := cfgSnapshot.Samba.User
	port := cfgSnapshot.Samba.Port
	shares := append([]config.SMBShare(nil), cfgSnapshot.Samba.Shares...)
	if port <= 0 {
		port = 4455
	}

	defaultAddr := fmt.Sprintf("smb://%s/MacBox", hostIP)
	if port != 445 {
		defaultAddr = fmt.Sprintf("smb://%s:%d/MacBox", hostIP, port)
	}

	// Construct list of shares with resolved addresses
	var shareItems []SMBShareItem
	for _, s := range shares {
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
		ShareName:        shareName,
		Path:             "/data",
		Address:          defaultAddr,
		User:             user,
		Port:             port,
		Status:           statusStr,
		HasConflict:      false,
		Message:          "Samba 服务已配置并映射至局域网",
		Shares:           shareItems,
		AvailableTargets: m.GetAvailableTargets(ctx),
	}, nil
}

func (m *Manager) GetAvailableTargets(ctx context.Context) []AvailableTarget {
	m.mu.Lock()
	cfgSnapshot, err := config.Snapshot(m.cfg)
	m.mu.Unlock()
	if err != nil {
		log.Printf("[MacBox Samba] 读取可用共享目录失败: %v", err)
		return nil
	}
	secondaryDisk := cfgSnapshot.Storage.SecondaryDisk
	secondaryMount := cfgSnapshot.Storage.SecondaryMount
	localMounts := append([]config.LocalMount(nil), cfgSnapshot.Storage.LocalMounts...)

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
	hasSecondary := secondaryDisk != "" || secondaryMount != ""
	for _, lm := range localMounts {
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
	for _, lm := range localMounts {
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
	return m.applyConfigLocked(ctx)
}

// applyConfigLocked renders and applies the current Samba configuration. The
// caller must hold m.mu. Keeping the lock across the external commands makes
// config mutation and service reload a single serialized operation.
func (m *Manager) applyConfigLocked(ctx context.Context) error {
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取 Samba 配置失败: %w", err)
	}
	sambaUser := strings.TrimSpace(cfgSnapshot.Samba.User)
	internalUser := m.internalUser()
	usernameMapPath := m.usernameMapPath()
	if sambaUser == "" {
		sambaUser = internalUser
	}
	if err := config.ValidateSambaUsername(sambaUser); err != nil {
		return fmt.Errorf("Samba 用户名无效: %w", err)
	}

	var sb strings.Builder
	sb.WriteString("[global]\n")
	sb.WriteString("   workgroup = WORKGROUP\n")
	sb.WriteString("   server string = MacBox\n")
	sb.WriteString("   server role = standalone server\n")
	sb.WriteString("   security = user\n")
	sb.WriteString("   map to guest = Never\n")
	if sambaUser != internalUser {
		sb.WriteString("   username map = " + usernameMapPath + "\n")
	}
	sb.WriteString("   dns proxy = no\n")
	sb.WriteString("   log file = /var/log/samba/log.%m\n")
	sb.WriteString("   max log size = 50\n\n")

	var dirsToCreate []string

	for _, s := range cfgSnapshot.Samba.Shares {
		if !s.Enabled {
			continue
		}

		cleanName := strings.TrimSpace(s.Name)
		if cleanName == "" {
			continue
		}
		if err := validateShareName(cleanName); err != nil {
			return fmt.Errorf("共享名称格式无效: %s: %w", cleanName, err)
		}

		cleanPath, pathErr := normalizeSharePath(s.Path)
		if pathErr != nil || hasControlChars(s.Comment) || len([]byte(s.Comment)) > 512 {
			return fmt.Errorf("共享配置包含非法控制字符: %s", cleanName)
		}
		dirsToCreate = append(dirsToCreate, cleanPath)

		sb.WriteString(fmt.Sprintf("[%s]\n", cleanName))
		if s.Comment != "" {
			sb.WriteString(fmt.Sprintf("   comment = %s\n", s.Comment))
		} else {
			sb.WriteString(fmt.Sprintf("   comment = MacBox Share %s\n", cleanName))
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

		sb.WriteString("   create mask = 0660\n")
		sb.WriteString("   directory mask = 0770\n")
		sb.WriteString("   force user = " + internalUser + "\n")
		sb.WriteString("   force group = " + internalUser + "\n\n")
	}

	confContent := sb.String()

	// 1. Ensure target dirs exist
	if len(dirsToCreate) > 0 {
		for _, d := range dirsToCreate {
			if _, err := m.vmMgr.Exec(ctx, "sudo", "mkdir", "-p", d); err != nil {
				return fmt.Errorf("创建共享目录失败: %s (%w)", d, err)
			}
		}
	}

	// 2. Write /etc/samba/smb.conf
	if out, err := m.vmMgr.ExecWithInput(ctx, strings.NewReader(confContent), "sudo", "tee", "/etc/samba/smb.conf"); err != nil {
		return fmt.Errorf("写入 smb.conf 失败: %s (%w)", out, err)
	}
	if sambaUser != internalUser {
		mapContent := fmt.Sprintf("%s = %s\n", internalUser, sambaUser)
		if out, err := m.vmMgr.ExecWithInput(ctx, strings.NewReader(mapContent), "sudo", "tee", usernameMapPath); err != nil {
			return fmt.Errorf("写入 Samba 用户映射失败: %s (%w)", out, err)
		}
		if out, err := m.vmMgr.Exec(ctx, "sudo", "chmod", "0600", usernameMapPath); err != nil {
			return fmt.Errorf("保护 Samba 用户映射失败: %s (%w)", out, err)
		}
	}

	// 3. Reload or restart Samba
	if out, err := m.vmMgr.Exec(ctx, "sudo", "systemctl", "reload", "smbd"); err != nil {
		if restartOut, restartErr := m.vmMgr.Exec(ctx, "sudo", "systemctl", "restart", "smbd"); restartErr != nil {
			return fmt.Errorf("重载 Samba 服务失败: %s; 重启失败: %s (%w)", out, restartOut, restartErr)
		}
	}

	return nil
}

// rollbackSharesLocked restores the previous share list after an apply
// failure. Without this, the YAML file could contain a configuration that the
// running Samba service rejected (or that was only partially written), so a
// later restart would unexpectedly apply a change the user was told had
// failed. The caller must hold m.mu.
func (m *Manager) rollbackSharesLocked(previous []config.SMBShare, operationErr error) error {
	if err := config.Update(m.cfg, func(updated *config.Config) error {
		updated.Samba.Shares = append([]config.SMBShare(nil), previous...)
		return nil
	}); err != nil {
		return fmt.Errorf("应用 Samba 配置失败: %v；回滚共享配置失败: %w", operationErr, err)
	}

	rollbackCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := m.applyConfigLocked(rollbackCtx); err != nil {
		return fmt.Errorf("应用 Samba 配置失败: %v；共享配置已回滚但恢复服务失败: %w", operationErr, err)
	}
	return operationErr
}

var shareIDRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func validateShareName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("共享服务名称不能为空")
	}
	if len([]byte(name)) > 128 {
		return fmt.Errorf("共享名称不能超过 128 个字节")
	}
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			continue
		}
		return fmt.Errorf("共享名称仅支持中文、字母、数字、下划线及连字符 (-)")
	}
	return nil
}

func normalizeSharePath(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		value = "/data"
	}
	if len([]byte(value)) > 4096 || hasControlChars(value) || !strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("共享目录必须是 /data 下的绝对路径")
	}
	clean := path.Clean(value)
	if clean != "/data" && !strings.HasPrefix(clean, "/data/") {
		return "", fmt.Errorf("共享目录必须位于 /data 下")
	}
	return clean, nil
}

func hasControlChars(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func (m *Manager) AddOrUpdateShare(ctx context.Context, share config.SMBShare) (*config.SMBShare, error) {
	share.Name = strings.TrimSpace(share.Name)
	if err := validateShareName(share.Name); err != nil {
		return nil, err
	}

	share.Path = strings.TrimSpace(share.Path)
	cleanPath, err := normalizeSharePath(share.Path)
	if err != nil {
		return nil, err
	}
	share.Path = cleanPath
	if hasControlChars(share.Comment) || len([]byte(share.Comment)) > 512 {
		return nil, fmt.Errorf("共享备注格式无效")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return nil, fmt.Errorf("读取共享配置失败: %w", err)
	}
	currentShares := append([]config.SMBShare(nil), cfgSnapshot.Samba.Shares...)
	if share.ID == "" {
		share.ID = fmt.Sprintf("share-%d", time.Now().UnixNano())
	} else if !shareIDRegex.MatchString(share.ID) {
		return nil, fmt.Errorf("共享 ID 格式无效")
	}

	// Check if updating existing or inserting
	foundIndex := -1
	for i, s := range currentShares {
		if s.ID == share.ID {
			foundIndex = i
			break
		}
	}

	// Check duplicate name on other shares
	for i, s := range currentShares {
		if s.Name == share.Name && i != foundIndex {
			return nil, fmt.Errorf("共享服务名称 '%s' 已被其他共享项占用，请使用其他名称", share.Name)
		}
	}

	updatedShares := append([]config.SMBShare(nil), currentShares...)
	if foundIndex >= 0 {
		updatedShares[foundIndex] = share
	} else {
		updatedShares = append(updatedShares, share)
	}

	if err := config.Update(m.cfg, func(updated *config.Config) error {
		updated.Samba.Shares = updatedShares
		return nil
	}); err != nil {
		return nil, fmt.Errorf("保存共享配置失败: %w", err)
	}

	if err := m.applyConfigLocked(ctx); err != nil {
		return nil, m.rollbackSharesLocked(currentShares, err)
	}

	return &share, nil
}

func (m *Manager) ToggleShare(ctx context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return false, fmt.Errorf("读取共享配置失败: %w", err)
	}
	found := false
	var newState bool
	updatedShares := append([]config.SMBShare(nil), cfgSnapshot.Samba.Shares...)
	for i, s := range updatedShares {
		if s.ID == id {
			updatedShares[i].Enabled = !s.Enabled
			newState = updatedShares[i].Enabled
			found = true
			break
		}
	}
	if !found {
		return false, fmt.Errorf("未找到 ID 为 %s 的共享项", id)
	}
	previousShares := append([]config.SMBShare(nil), cfgSnapshot.Samba.Shares...)
	if err := config.Update(m.cfg, func(updated *config.Config) error {
		updated.Samba.Shares = updatedShares
		return nil
	}); err != nil {
		return false, fmt.Errorf("保存共享状态失败: %w", err)
	}

	if err := m.applyConfigLocked(ctx); err != nil {
		return newState, m.rollbackSharesLocked(previousShares, err)
	}
	return newState, nil
}

func (m *Manager) DeleteShare(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取共享配置失败: %w", err)
	}
	previousShares := append([]config.SMBShare(nil), cfgSnapshot.Samba.Shares...)
	var newShares []config.SMBShare
	found := false
	for _, s := range cfgSnapshot.Samba.Shares {
		if s.ID == id {
			found = true
			continue
		}
		newShares = append(newShares, s)
	}
	if !found {
		return fmt.Errorf("未找到 ID 为 %s 的共享项", id)
	}

	if err := config.Update(m.cfg, func(updated *config.Config) error {
		updated.Samba.Shares = newShares
		return nil
	}); err != nil {
		return fmt.Errorf("保存共享配置失败: %w", err)
	}

	if err := m.applyConfigLocked(ctx); err != nil {
		return m.rollbackSharesLocked(previousShares, err)
	}
	return nil
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

// SyncCredentials makes the first Web administrator's credentials the only
// SMB credentials. The password is retained in process memory only; Samba's
// passdb persists the verifier inside the VM without exposing the plaintext in
// the host config file.
func (m *Manager) SyncCredentials(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if err := config.ValidateSambaUsername(username); err != nil {
		return err
	}
	if err := config.ValidateSambaPassword(password); err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取 SMB 凭据配置失败: %w", err)
	}
	if cfgSnapshot.Samba.User != username {
		if err := config.Update(m.cfg, func(updated *config.Config) error {
			updated.Samba.User = username
			return nil
		}); err != nil {
			return fmt.Errorf("保存 SMB 用户名失败: %w", err)
		}
	}
	m.credentialUser = username
	m.credentialPassword = password

	vmStat, statusErr := m.vmMgr.GetStatusContext(ctx)
	if statusErr != nil || vmStat == nil || vmStat.Status != "Running" {
		// The next VM start in this process applies the queued credentials. After
		// a backend restart, the administrator's next login queues them again.
		return nil
	}
	return m.ensurePasswordLocked(ctx)
}

func (m *Manager) EnsurePassword(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.ensurePasswordLocked(ctx)
}

func (m *Manager) ensurePasswordLocked(ctx context.Context) error {
	internalUser := m.internalUser()
	pwd := m.credentialPassword
	if pwd == "" {
		// An existing VM already keeps the Samba verifier in passdb.tdb. We still
		// refresh shares and the username map, but never invent or persist a second
		// password that would diverge from the Web administrator account.
		return m.applyConfigLocked(ctx)
	}
	if err := config.ValidateSambaPassword(pwd); err != nil {
		return fmt.Errorf("Samba 密码未初始化或不符合安全要求，请先设置至少 8 个字符的密码: %w", err)
	}
	user := strings.TrimSpace(m.credentialUser)
	if user == "" {
		cfgSnapshot, err := config.Snapshot(m.cfg)
		if err != nil {
			return fmt.Errorf("读取 Samba 用户名配置失败: %w", err)
		}
		user = strings.TrimSpace(cfgSnapshot.Samba.User)
	}
	if err := config.ValidateSambaUsername(user); err != nil {
		return fmt.Errorf("Samba 用户名无效: %w", err)
	}
	if _, err := m.vmMgr.Exec(ctx, "id", "-u", internalUser); err != nil {
		if _, userErr := m.vmMgr.Exec(ctx, "sudo", "useradd", "-M", "-s", "/usr/sbin/nologin", internalUser); userErr != nil {
			return userErr
		}
	}
	if out, err := m.vmMgr.ExecWithInput(ctx, strings.NewReader(pwd+"\n"+pwd+"\n"), "sudo", "smbpasswd", "-a", internalUser, "-s"); err != nil {
		return fmt.Errorf("同步 Samba 密码失败: %s (%w)", out, err)
	}
	if out, err := m.vmMgr.Exec(ctx, "sudo", "smbpasswd", "-e", internalUser); err != nil {
		return fmt.Errorf("启用 Samba 用户失败: %s (%w)", out, err)
	}
	return m.applyConfigLocked(ctx)
}

func (m *Manager) Restart(ctx context.Context) error {
	if err := m.ApplyConfig(ctx); err != nil {
		return err
	}
	out, err := m.vmMgr.Exec(ctx, "sudo", "systemctl", "restart", "smbd", "nmbd")
	if err != nil {
		return fmt.Errorf("重启 Samba 失败: %s (%w)", out, err)
	}
	return nil
}
