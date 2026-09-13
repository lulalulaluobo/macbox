package system

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/lulalulaluobo/macbox/pkg/vm"
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

var validLinuxUsername = regexp.MustCompile(`^[a-z_][a-z0-9_-]{1,31}$`)

func validateLinuxUsername(username string) error {
	if username == "" {
		return fmt.Errorf("用户名不能为空")
	}
	if !validLinuxUsername.MatchString(username) {
		return fmt.Errorf("用户名不合规: 必须小写字母或下划线开头，2-32位，仅限字母/数字/下划线/减号")
	}
	return nil
}

func validateLinuxPassword(password string, required bool) error {
	if !required && password == "" {
		return nil
	}
	if password == "" {
		return fmt.Errorf("密码不能为空")
	}
	if len([]byte(password)) < 12 {
		return fmt.Errorf("密码长度至少为 12 个字节")
	}
	if len([]byte(password)) > 1024 {
		return fmt.Errorf("密码长度不能超过 1024 个字节")
	}
	for _, r := range password {
		if unicode.IsControl(r) {
			return fmt.Errorf("密码不能包含控制字符")
		}
	}
	return nil
}

func NewUserManager(vmMgr *vm.Manager) *UserManager {
	return &UserManager{
		vmMgr: vmMgr,
	}
}

// ListUsers lists all interactive human and root users in the Linux VM
func (um *UserManager) ListUsers(ctx context.Context) ([]SystemUser, error) {
	// Query /etc/passwd for users with UID == 0, UID >= 1000, or common mapped UID 501
	awkProgram := `$1 != "macboxctl" && ($3 >= 1000 || $3 == 0 || $3 == 501) && $7 !~ /nologin|false/ {print $1":"$3":"$4":"$6":"$7}`
	out, err := um.vmMgr.Exec(ctx, "awk", "-F:", awkProgram, "/etc/passwd")
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
		if !validLinuxUsername.MatchString(username) {
			continue
		}
		grpOut, _ := um.vmMgr.Exec(ctx, "id", "-Gn", username)
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

// CreateUser creates a new Linux user with bash and optionally assigns the sudo group.
// Docker group membership is intentionally not granted implicitly: membership in
// docker is effectively root-equivalent and must be an explicit, separately
// audited administrator action.
func (um *UserManager) CreateUser(ctx context.Context, username, password string, isSudo bool) error {
	username = strings.TrimSpace(username)
	if err := validateLinuxUsername(username); err != nil {
		return err
	}

	if username == "root" {
		return fmt.Errorf("不能创建名为 root 的用户")
	}
	if err := validateLinuxPassword(password, false); err != nil {
		return err
	}

	// 1. Create user
	if out, err := um.vmMgr.Exec(ctx, "sudo", "useradd", "-m", "-s", "/bin/bash", username); err != nil {
		return fmt.Errorf("创建用户失败: %s (%w)", out, err)
	}

	// 2. Set password if provided
	if password != "" {
		if out, err := um.vmMgr.ExecWithInput(ctx, strings.NewReader(username+":"+password+"\n"), "sudo", "chpasswd"); err != nil {
			return fmt.Errorf("设置密码失败: %s (%w)", out, err)
		}
	}

	// 3. Assign groups
	var groups []string
	if isSudo {
		groups = append(groups, "sudo")
	}

	if len(groups) > 0 {
		if out, err := um.vmMgr.Exec(ctx, "sudo", "usermod", "-aG", strings.Join(groups, ","), username); err != nil {
			return fmt.Errorf("分配用户组失败: %s (%w)", out, err)
		}
	}

	return nil
}

// UpdateUserPassword updates the password for any given system user
func (um *UserManager) UpdateUserPassword(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if err := validateLinuxUsername(username); err != nil {
		return err
	}
	if err := validateLinuxPassword(password, true); err != nil {
		return err
	}

	if out, err := um.vmMgr.ExecWithInput(ctx, strings.NewReader(username+":"+password+"\n"), "sudo", "chpasswd"); err != nil {
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
	if err := validateLinuxUsername(username); err != nil {
		return err
	}
	if username == "root" {
		return fmt.Errorf("安全保护: 禁止删除超级管理员 root 账号")
	}

	if out, err := um.vmMgr.Exec(ctx, "sudo", "userdel", "-r", "-f", username); err != nil {
		return fmt.Errorf("删除用户失败: %s (%w)", out, err)
	}
	return nil
}
