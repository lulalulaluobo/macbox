package system

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/luluen/mac-nas/pkg/vm"
)

type SystemUser struct {
	Username string   `json:"username"`
	UID      int      `json:"uid"`
	GID      int      `json:"gid"`
	HomeDir  string   `json:"homeDir"`
	Shell    string   `json:"shell"`
	Groups   []string `json:"groups"`
	IsRoot   bool     `json:"isRoot"`
	IsSudo   bool     `json:"isSudo"`
}

type UserManager struct {
	vmMgr *vm.Manager
}

func NewUserManager(vmMgr *vm.Manager) *UserManager {
	return &UserManager{
		vmMgr: vmMgr,
	}
}

// ListUsers lists all interactive human and root users in the Linux VM
func (um *UserManager) ListUsers(ctx context.Context) ([]SystemUser, error) {
	// Query /etc/passwd for users with UID == 0, UID >= 1000, or common mapped UID 501
	cmd := `awk -F: '($3 >= 1000 || $3 == 0 || $3 == 501) && $7 !~ /nologin|false/ {print $1":"$3":"$4":"$6":"$7}' /etc/passwd`
	out, err := um.vmMgr.Exec(ctx, "bash", "-c", cmd)
	if err != nil {
		return nil, fmt.Errorf("list users failed: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(out), "\n")
	var users []SystemUser

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) < 5 {
			continue
		}

		username := parts[0]
		uid, _ := strconv.Atoi(parts[1])
		gid, _ := strconv.Atoi(parts[2])
		homeDir := parts[3]
		shell := parts[4]

		// Query groups for this user
		grpCmd := fmt.Sprintf("id -Gn %s 2>/dev/null", username)
		grpOut, _ := um.vmMgr.Exec(ctx, "bash", "-c", grpCmd)
		rawGroups := strings.Fields(strings.TrimSpace(grpOut))

		isRoot := (username == "root" || uid == 0)
		isSudo := isRoot

		for _, g := range rawGroups {
			if g == "sudo" || g == "wheel" || g == "admin" {
				isSudo = true
				break
			}
		}

		users = append(users, SystemUser{
			Username: username,
			UID:      uid,
			GID:      gid,
			HomeDir:  homeDir,
			Shell:    shell,
			Groups:   rawGroups,
			IsRoot:   isRoot,
			IsSudo:   isSudo,
		})
	}

	return users, nil
}

// CreateUser creates a new Linux user with bash and optionally assigns sudo/docker groups
func (um *UserManager) CreateUser(ctx context.Context, username, password string, isSudo bool) error {
	username = strings.TrimSpace(username)
	if username == "" {
		return fmt.Errorf("用户名不能为空")
	}

	validUsername := regexp.MustCompile(`^[a-z_][a-z0-9_-]{1,31}$`)
	if !validUsername.MatchString(username) {
		return fmt.Errorf("用户名不合规: 必须小写字母或下划线开头，2-32位，仅限字母/数字/下划线/减号")
	}

	if username == "root" {
		return fmt.Errorf("不能创建名为 root 的用户")
	}

	// 1. Create user
	addCmd := fmt.Sprintf("sudo useradd -m -s /bin/bash %s", username)
	if out, err := um.vmMgr.Exec(ctx, "bash", "-c", addCmd); err != nil {
		return fmt.Errorf("创建用户失败: %s (%w)", out, err)
	}

	// 2. Set password if provided
	if password != "" {
		pwdCmd := fmt.Sprintf("echo '%s:%s' | sudo chpasswd", username, password)
		if out, err := um.vmMgr.Exec(ctx, "bash", "-c", pwdCmd); err != nil {
			return fmt.Errorf("设置密码失败: %s (%w)", out, err)
		}
	}

	// 3. Assign groups
	var groups []string
	if isSudo {
		groups = append(groups, "sudo")
	}
	// Also add to docker group so user can manage containers
	groups = append(groups, "docker")

	if len(groups) > 0 {
		grpCmd := fmt.Sprintf("sudo usermod -aG %s %s", strings.Join(groups, ","), username)
		_, _ = um.vmMgr.Exec(ctx, "bash", "-c", grpCmd)
	}

	return nil
}

// UpdateUserPassword updates the password for any given system user
func (um *UserManager) UpdateUserPassword(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if username == "" {
		return fmt.Errorf("用户名不能为空")
	}
	if password == "" {
		return fmt.Errorf("密码不能为空")
	}

	pwdCmd := fmt.Sprintf("echo '%s:%s' | sudo chpasswd", username, password)
	if out, err := um.vmMgr.Exec(ctx, "bash", "-c", pwdCmd); err != nil {
		return fmt.Errorf("修改密码失败: %s (%w)", out, err)
	}
	return nil
}

// UpdateRootPassword updates the root password
func (um *UserManager) UpdateRootPassword(ctx context.Context, password string) error {
	return um.UpdateUserPassword(ctx, "root", password)
}

// DeleteUser deletes a system user and their home directory
func (um *UserManager) DeleteUser(ctx context.Context, username string) error {
	username = strings.TrimSpace(username)
	if username == "" {
		return fmt.Errorf("用户名不能为空")
	}
	if username == "root" {
		return fmt.Errorf("安全保护: 禁止删除超级管理员 root 账号")
	}

	delCmd := fmt.Sprintf("sudo userdel -r -f %s", username)
	if out, err := um.vmMgr.Exec(ctx, "bash", "-c", delCmd); err != nil {
		return fmt.Errorf("删除用户失败: %s (%w)", out, err)
	}
	return nil
}
