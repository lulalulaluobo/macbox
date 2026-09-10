package samba

import (
	"context"
	"fmt"
	"strings"

	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/vm"
)

type SambaStatus struct {
	ShareName   string `json:"shareName"`
	Path        string `json:"path"`
	Address     string `json:"address"`
	User        string `json:"user"`
	Port        int    `json:"port"`
	Status      string `json:"status"` // "running", "stopped", "unknown"
	HasConflict bool   `json:"hasConflict"`
	Message     string `json:"message"`
}

type Manager struct {
	cfg   *config.Config
	vmMgr *vm.Manager
}

func NewManager(cfg *config.Config, vmMgr *vm.Manager) *Manager {
	return &Manager{
		cfg:   cfg,
		vmMgr: vmMgr,
	}
}

func (m *Manager) GetStatus(ctx context.Context, hostIP string) (*SambaStatus, error) {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}

	vmStat, _ := m.vmMgr.GetStatus()
	statusStr := "stopped"

	if vmStat.Status == "Running" {
		out, err := m.vmMgr.Exec(ctx, "systemctl", "is-active", "smbd")
		if err == nil && strings.TrimSpace(out) == "active" {
			statusStr = "running"
		}
	}

	addr := fmt.Sprintf("smb://%s/MacNAS", hostIP)
	if m.cfg.Samba.Port != 445 && m.cfg.Samba.Port > 0 {
		addr = fmt.Sprintf("smb://%s:%d/MacNAS", hostIP, m.cfg.Samba.Port)
	}

	return &SambaStatus{
		ShareName:   m.cfg.Samba.ShareName,
		Path:        "/data",
		Address:     addr,
		User:        m.cfg.Samba.User,
		Port:        m.cfg.Samba.Port,
		Status:      statusStr,
		HasConflict: false,
		Message:     "Samba 服务已配置并映射至局域网",
	}, nil
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

func (m *Manager) Restart(ctx context.Context) error {
	out, err := m.vmMgr.Exec(ctx, "systemctl", "restart", "smbd", "nmbd")
	if err != nil {
		return fmt.Errorf("重启 Samba 失败: %s (%w)", out, err)
	}
	return nil
}
