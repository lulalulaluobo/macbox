package vm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"text/template"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/storage"
	"gopkg.in/yaml.v3"
)

type VMStatus struct {
	Name         string    `json:"name"`
	Status       string    `json:"status"` // "Running", "Stopped", "NotCreated", "Broken"
	Dir          string    `json:"dir"`
	Arch         string    `json:"arch"`
	CPUs         int       `json:"cpus"`
	Memory       uint64    `json:"memory"`
	Disk         uint64    `json:"disk"`
	SSHLocalPort int       `json:"sshLocalPort"`
	DockerSocket string    `json:"dockerSocket"`
	DockerReady  bool      `json:"dockerReady"`
	Errors       []string  `json:"errors,omitempty"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// StartProgress is deliberately coarse-grained. Lima does not expose a
// stable percentage for image creation, so the API reports meaningful
// lifecycle checkpoints instead of pretending to know byte-level progress.
type StartProgress func(stage string, progress int, message string)

type LocalMountProbe struct {
	ID              string    `json:"id"`
	HostPath        string    `json:"hostPath"`
	GuestTarget     string    `json:"guestTarget"`
	ExpectedEnabled bool      `json:"expectedEnabled"`
	HostReady       bool      `json:"hostReady"`
	SourceMounted   bool      `json:"sourceMounted"`
	TargetMounted   bool      `json:"targetMounted"`
	Healthy         bool      `json:"healthy"`
	Status          string    `json:"status"`
	Message         string    `json:"message"`
	CheckedAt       time.Time `json:"checkedAt"`
}

type LimaInstanceJSON struct {
	Name         string   `json:"name"`
	Status       string   `json:"status"`
	Dir          string   `json:"dir"`
	Arch         string   `json:"arch"`
	CPUs         int      `json:"cpus"`
	Memory       uint64   `json:"memory"`
	Disk         uint64   `json:"disk"`
	SSHLocalPort int      `json:"sshLocalPort"`
	Errors       []string `json:"errors"`
}

type Manager struct {
	cfg          *config.Config
	instanceName string
	mu           sync.RWMutex
	statusMu     sync.Mutex
	lastError    string
	vmAction     string // "starting", "stopping", "restarting", "" (idle)
	configDirty  bool   // true when config changed and VM needs restart
	cachedStatus *VMStatus
	cachedAt     time.Time
}

// FindHomebrew returns the Homebrew executable used to install optional host
// dependencies. GUI applications do not inherit an interactive shell PATH, so
// the standard Apple Silicon and Intel locations are checked explicitly.
func FindHomebrew() (string, bool) {
	if path, err := exec.LookPath("brew"); err == nil {
		return path, true
	}
	for _, candidate := range []string{"/opt/homebrew/bin/brew", "/usr/local/bin/brew"} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}
	return "", false
}

// FindLima resolves limactl for both interactive shells and GUI-launched
// processes. macOS apps started from Finder or the menu bar do not reliably
// inherit the user's shell PATH, while Homebrew's Apple Silicon installation
// normally lives outside the system default PATH.
func FindLima() (string, bool) {
	if path, err := exec.LookPath("limactl"); err == nil {
		return path, true
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/opt/homebrew/bin/limactl",
		"/usr/local/bin/limactl",
		"/usr/bin/limactl",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, "homebrew", "bin", "limactl"),
			filepath.Join(home, ".homebrew", "bin", "limactl"),
		)
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
			return candidate, true
		}
	}
	return "", false
}

// PrepareLimaEnvironment makes legacy direct exec.Command("limactl", ...)
// call sites work when MacBox was launched from Finder. The explicit resolver
// remains the source of truth for diagnostics; this environment bridge keeps
// storage and terminal helpers compatible without duplicating path logic.
func PrepareLimaEnvironment() {
	path, ok := FindLima()
	if !ok {
		return
	}
	dir := filepath.Dir(path)
	current := os.Getenv("PATH")
	for _, entry := range strings.Split(current, string(os.PathListSeparator)) {
		if entry == dir {
			return
		}
	}
	if current == "" {
		_ = os.Setenv("PATH", dir)
		return
	}
	_ = os.Setenv("PATH", dir+string(os.PathListSeparator)+current)
}

// InstallLima installs Lima through an existing Homebrew installation and
// verifies that limactl is available afterwards. Homebrew itself is never
// bootstrapped automatically because doing so executes a remote installer.
func InstallLima(ctx context.Context) error {
	if _, ok := FindLima(); ok {
		return nil
	}
	brew, ok := FindHomebrew()
	if !ok {
		return fmt.Errorf("未检测到 Homebrew，请先按引导安装 Homebrew")
	}
	out, err := runHostCommand(ctx, brew, "install", "lima")
	if err != nil {
		return fmt.Errorf("Homebrew 安装 Lima 失败: %s (%w)", strings.TrimSpace(out), err)
	}
	if _, ok := FindLima(); ok {
		PrepareLimaEnvironment()
		return nil
	}
	return fmt.Errorf("Homebrew 已完成，但未找到 limactl，请重新打开 MacBox 后重试")
}

func (m *Manager) InvalidateCache() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cachedStatus = nil
}

func (m *Manager) SetLastError(err string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastError = err
	m.cachedStatus = nil
}

func (m *Manager) GetLastError() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.lastError
}

func (m *Manager) SetVMAction(action string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.vmAction = action
	m.cachedStatus = nil
}

// BeginVMAction atomically reserves the VM lifecycle state. Only one
// start/stop/restart operation may run at a time; otherwise concurrent
// requests can race limactl and leave the VM state/configuration ambiguous.
func (m *Manager) BeginVMAction(action string) bool {
	if action == "" {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.vmAction != "" {
		return false
	}
	m.vmAction = action
	m.cachedStatus = nil
	return true
}

// EndVMAction releases a lifecycle reservation. It is deliberately
// idempotent so deferred cleanup remains safe after an operation fails.
func (m *Manager) EndVMAction() {
	m.SetVMAction("")
}

func (m *Manager) GetVMAction() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.vmAction
}

// InstanceName returns the validated Lima instance identifier. The name is
// fixed when the manager is constructed, so request handlers do not need to
// read the shared mutable Config object for every command.
func (m *Manager) InstanceName() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.instanceName
}

func (m *Manager) SetConfigDirty(dirty bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configDirty = dirty
}

func (m *Manager) IsConfigDirty() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.configDirty
}

// AddForwardedPortsChanged records only the host ports explicitly published
// by an installed Compose application and reports whether the VM forwarding
// configuration gained a new port.
func (m *Manager) AddForwardedPortsChanged(ports ...int) (bool, error) {
	ports = config.NormalizeForwardedPorts(ports)
	if len(ports) == 0 {
		return false, nil
	}

	changed := false
	if err := config.Update(m.cfg, func(updated *config.Config) error {
		previous := config.NormalizeForwardedPorts(updated.VM.ForwardedPorts)
		merged := append([]int(nil), previous...)
		merged = append(merged, ports...)
		merged = config.NormalizeForwardedPorts(merged)
		if len(merged) != len(previous) {
			changed = true
		} else {
			for i := range merged {
				if merged[i] != previous[i] {
					changed = true
					break
				}
			}
		}
		if changed {
			updated.VM.ForwardedPorts = merged
		}
		return nil
	}); err != nil {
		return false, fmt.Errorf("保存端口转发配置失败: %w", err)
	}
	if !changed {
		return false, nil
	}
	m.mu.Lock()
	m.configDirty = true
	m.cachedStatus = nil
	m.mu.Unlock()
	return true, nil
}

// AddForwardedPorts preserves the original fire-and-forget API for callers
// that only need to persist forwarding entries.
func (m *Manager) AddForwardedPorts(ports ...int) error {
	_, err := m.AddForwardedPortsChanged(ports...)
	return err
}

// RestartForPortForwarding serializes the short VM restart needed to apply a
// newly discovered Compose port. This prevents an automatic restart from
// racing with a user-triggered VM lifecycle action.
func (m *Manager) RestartForPortForwarding(ctx context.Context, projectRoot string) error {
	if !m.BeginVMAction("restarting-for-port-forwarding") {
		return fmt.Errorf("已有虚拟机操作正在进行")
	}
	defer m.EndVMAction()

	if err := m.Restart(ctx, projectRoot); err != nil {
		return err
	}
	m.SetConfigDirty(false)
	return nil
}

func NewManager(cfg *config.Config) *Manager {
	if cfg == nil {
		cfg = config.DefaultConfig()
	}
	name, err := config.NormalizeVMName(cfg.VM.Name)
	if err != nil {
		name = "macbox"
	}
	return &Manager{
		cfg:          cfg,
		instanceName: name,
	}
}

// guestProductSlug returns the canonical internal path prefix used by MacBox.
func (m *Manager) guestProductSlug() string {
	return "macbox"
}

func (m *Manager) guestManagementUser() string {
	return "macboxctl"
}

func (m *Manager) guestProductGroup() string {
	return "macbox"
}

// GuestSkillsPaths returns the effective scan locations for the current VM.
func (m *Manager) GuestSkillsPaths() []string {
	user := m.guestManagementUser()
	return []string{
		"/home/" + user + "/.agents/skills", "/root/.agents/skills",
		"/home/" + user + "/.claude/skills", "/root/.claude/skills",
		"/home/" + user + "/.codex/skills", "/root/.codex/skills",
	}
}

// GetStatus checks Lima for the current status of the MacBox instance (cached with 3s TTL)
func (m *Manager) GetStatus() (*VMStatus, error) {
	return m.GetStatusContext(context.Background())
}

// GetStatusContext is the request-aware status query. The short cache avoids
// starting multiple limactl processes during a dashboard refresh, while the
// context still cancels a slow probe when its caller disconnects.
func (m *Manager) GetStatusContext(ctx context.Context) (*VMStatus, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	m.mu.RLock()
	if m.cachedStatus != nil && time.Since(m.cachedAt) < 3*time.Second {
		cpy := cloneVMStatus(m.cachedStatus)
		m.mu.RUnlock()
		return cpy, nil
	}
	m.mu.RUnlock()

	m.statusMu.Lock()
	defer m.statusMu.Unlock()
	// Recheck after waiting for another caller to finish its probe.
	m.mu.RLock()
	if m.cachedStatus != nil && time.Since(m.cachedAt) < 3*time.Second {
		cpy := cloneVMStatus(m.cachedStatus)
		m.mu.RUnlock()
		return cpy, nil
	}
	m.mu.RUnlock()

	outputText, err := runHostCommand(ctx, "limactl", "list", "--json")
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		// limactl might fail or no instances
		res := &VMStatus{
			Name:        m.instanceName,
			Status:      "NotCreated",
			UpdatedAt:   time.Now(),
			DockerReady: false,
		}
		m.mu.Lock()
		m.cachedStatus = res
		m.cachedAt = time.Now()
		m.mu.Unlock()
		return cloneVMStatus(res), nil
	}

	scanner := bufio.NewScanner(strings.NewReader(outputText))
	for scanner.Scan() {
		line := scanner.Text()
		var inst LimaInstanceJSON
		if err := json.Unmarshal([]byte(line), &inst); err == nil {
			if inst.Name == m.instanceName {
				sock := m.GetDockerSocketPath(inst.Dir)
				ready := m.IsSocketReady(sock)

				errs := append([]string(nil), inst.Errors...)
				if lastErr := m.GetLastError(); lastErr != "" {
					errs = append(errs, lastErr)
				}

				res := &VMStatus{
					Name:         inst.Name,
					Status:       inst.Status,
					Dir:          inst.Dir,
					Arch:         inst.Arch,
					CPUs:         inst.CPUs,
					Memory:       inst.Memory,
					Disk:         inst.Disk,
					SSHLocalPort: inst.SSHLocalPort,
					DockerSocket: sock,
					DockerReady:  ready,
					Errors:       errs,
					UpdatedAt:    time.Now(),
				}
				m.mu.Lock()
				m.cachedStatus = res
				m.cachedAt = time.Now()
				m.mu.Unlock()
				return cloneVMStatus(res), nil
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("解析 Lima 状态失败: %w", err)
	}

	var notCreatedErrs []string
	if lastErr := m.GetLastError(); lastErr != "" {
		notCreatedErrs = append(notCreatedErrs, lastErr)
	}

	res := &VMStatus{
		Name:        m.instanceName,
		Status:      "NotCreated",
		Errors:      notCreatedErrs,
		UpdatedAt:   time.Now(),
		DockerReady: false,
	}
	m.mu.Lock()
	m.cachedStatus = res
	m.cachedAt = time.Now()
	m.mu.Unlock()
	return cloneVMStatus(res), nil
}

func cloneVMStatus(status *VMStatus) *VMStatus {
	if status == nil {
		return nil
	}
	clone := *status
	clone.Errors = append([]string(nil), status.Errors...)
	return &clone
}

func (m *Manager) GetDockerSocketPath(instanceDir string) string {
	if instanceDir != "" {
		return filepath.Join(instanceDir, "sock", "docker.sock")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".lima", m.instanceName, "sock", "docker.sock")
}

func (m *Manager) IsSocketReady(sockPath string) bool {
	if _, err := os.Stat(sockPath); err != nil {
		return false
	}
	conn, err := net.DialTimeout("unix", sockPath, 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// EnsureDataDisk ensures the Managed Disk exists in Lima
func (m *Manager) EnsureDataDisk(size string) error {
	return m.EnsureDataDiskContext(context.Background(), size)
}

func (m *Manager) EnsureDataDiskContext(ctx context.Context, size string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return err
	}
	diskName, err := config.NormalizeDataDiskName(cfgSnapshot.VM.DataDiskName)
	if err != nil {
		return err
	}
	disks, err := storage.ListManagedDisksContext(ctx)
	if err != nil {
		return fmt.Errorf("读取 Lima 数据盘列表失败: %w", err)
	}
	for _, d := range disks {
		if d.Name == diskName {
			return nil // already exists
		}
	}

	if size == "" {
		size = "50GiB"
	}
	return storage.CreateManagedDiskContext(ctx, diskName, size)
}

// ValidateDataDiskContext checks the host-side Lima data disk before an
// existing VM is started. A managed disk can become unusable when an
// external image is unmounted or moved; letting limactl report that failure
// later produces a long, opaque initialization error in the UI.
func (m *Manager) ValidateDataDiskContext(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取虚拟机配置失败: %w", err)
	}
	diskName, err := config.NormalizeDataDiskName(cfgSnapshot.VM.DataDiskName)
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("读取用户目录失败: %w", err)
	}

	instanceDir := filepath.Join(home, ".lima", m.instanceName)
	if _, err := os.Stat(instanceDir); os.IsNotExist(err) {
		// A first-run VM does not have a managed disk yet; Start will create it.
		return nil
	} else if err != nil {
		return fmt.Errorf("检查 Lima 实例目录失败: %w", err)
	}

	diskPath := filepath.Join(home, ".lima", "_disks", diskName, "datadisk")
	info, err := os.Lstat(diskPath)
	if os.IsNotExist(err) {
		return fmt.Errorf("Lima 数据盘 %q 不存在，请在存储设置中重新绑定数据盘后再试", diskName)
	}
	if err != nil {
		return fmt.Errorf("检查 Lima 数据盘失败: %w", err)
	}

	if info.Mode()&os.ModeSymlink != 0 {
		target, readErr := os.Readlink(diskPath)
		if readErr != nil {
			return fmt.Errorf("读取 Lima 数据盘链接失败: %w", readErr)
		}
		targetInfo, statErr := os.Stat(diskPath)
		if os.IsNotExist(statErr) {
			backupPath := filepath.Join(filepath.Dir(diskPath), "datadisk.internal.bak")
			backupHint := ""
			if _, backupErr := os.Stat(backupPath); backupErr == nil {
				backupHint = "检测到本机仍有内部数据盘备份，可在存储设置中解除外接盘绑定后恢复。"
			}
			return fmt.Errorf("外接数据盘镜像不存在: %s。请重新挂载原存储位置后重试；%s", target, backupHint)
		}
		if statErr != nil {
			return fmt.Errorf("检查外接数据盘镜像失败: %w", statErr)
		}
		if !targetInfo.Mode().IsRegular() {
			return fmt.Errorf("Lima 数据盘链接目标不是普通镜像文件: %s", target)
		}
		return nil
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return fmt.Errorf("Lima 数据盘不是可用的普通文件: %s", diskPath)
	}
	return nil
}

// GenerateConfig renders templates/vm/macbox.yaml.tmpl into ~/.macbox/macbox.yaml
func (m *Manager) GenerateConfigFile(tmplPath, outputPath string) error {
	tmplData, err := os.ReadFile(tmplPath)
	if err != nil {
		return fmt.Errorf("read vm template error: %w", err)
	}

	tmpl, err := template.New("macbox-vm").Funcs(template.FuncMap{
		"shellQuote": shellQuote,
		"yamlQuote":  yamlQuote,
	}).Parse(string(tmplData))
	if err != nil {
		return fmt.Errorf("parse vm template error: %w", err)
	}

	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取配置快照失败: %w", err)
	}
	dataDiskNameValue := cfgSnapshot.VM.DataDiskName
	cpus := cfgSnapshot.VM.CPUs
	memory := cfgSnapshot.VM.Memory
	diskSize := cfgSnapshot.VM.DiskSize
	sambaPort := cfgSnapshot.Samba.Port
	listenAddress := cfgSnapshot.ListenAddress
	forwardedPorts := append([]int(nil), cfgSnapshot.VM.ForwardedPorts...)
	localMounts := append([]config.LocalMount(nil), cfgSnapshot.Storage.LocalMounts...)
	m.mu.RLock()
	instanceName := m.instanceName
	m.mu.RUnlock()

	dataDiskName, err := config.NormalizeDataDiskName(dataDiskNameValue)
	if err != nil {
		return err
	}
	aiSkillsHostPath, err := config.NormalizeAISkillsHostPath(cfgSnapshot.Terminal.AISkillsHostPath)
	if err != nil {
		return err
	}
	if cfgSnapshot.Terminal.AISkillsEnabled {
		if aiSkillsHostPath == "" {
			return fmt.Errorf("AI Skill 映射已启用但未配置本机目录")
		}
		info, statErr := os.Stat(aiSkillsHostPath)
		if os.IsNotExist(statErr) {
			return fmt.Errorf("本机 AI Skill 目录不存在: %s", aiSkillsHostPath)
		}
		if statErr != nil {
			return fmt.Errorf("检查本机 AI Skill 目录失败: %w", statErr)
		}
		if !info.IsDir() {
			return fmt.Errorf("本机 AI Skill 路径不是目录: %s", aiSkillsHostPath)
		}
	}
	for i := range localMounts {
		target, err := config.NormalizeGuestTarget(localMounts[i].GuestTarget)
		if err != nil {
			return fmt.Errorf("本地挂载 %q 配置无效: %w", localMounts[i].ID, err)
		}
		localMounts[i].GuestTarget = target
		if err := config.ValidateLocalMount(localMounts[i]); err != nil {
			return fmt.Errorf("本地挂载 %q 配置无效: %w", localMounts[i].ID, err)
		}
	}

	data := struct {
		CPUs             int
		Memory           int
		DiskSize         int
		DataDiskName     string
		SambaPort        int
		HostBindAddress  string
		ForwardedPorts   []int
		LocalMounts      []config.LocalMount
		AISkillsEnabled  bool
		AISkillsHostPath string
	}{
		CPUs:             cpus,
		Memory:           memory,
		DiskSize:         diskSize,
		DataDiskName:     dataDiskName,
		SambaPort:        sambaPort,
		HostBindAddress:  config.NormalizeListenAddress(listenAddress),
		ForwardedPorts:   config.NormalizeForwardedPorts(forwardedPorts),
		LocalMounts:      localMounts,
		AISkillsEnabled:  cfgSnapshot.Terminal.AISkillsEnabled,
		AISkillsHostPath: aiSkillsHostPath,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return fmt.Errorf("execute vm template error: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0700); err != nil {
		return err
	}

	previousOutput, outputErr := os.ReadFile(outputPath)
	outputExisted := outputErr == nil
	if outputErr != nil && !os.IsNotExist(outputErr) {
		return fmt.Errorf("读取现有虚拟机配置失败: %w", outputErr)
	}
	instancePath := ""
	home, homeErr := os.UserHomeDir()
	if homeErr != nil {
		return fmt.Errorf("读取用户目录失败: %w", homeErr)
	}
	instanceDir := filepath.Join(home, ".lima", instanceName)
	if _, err := os.Stat(instanceDir); err == nil {
		instancePath = filepath.Join(instanceDir, "lima.yaml")
	}

	if err := writePrivateFileAtomically(outputPath, buf.Bytes()); err != nil {
		return err
	}

	// Also sync to ~/.lima/<instance>/lima.yaml if the instance directory exists.
	// If the second atomic replacement fails, restore the first file so the two
	// config locations cannot silently describe different VM settings.
	if instancePath != "" {
		if err := writePrivateFileAtomically(instancePath, buf.Bytes()); err != nil {
			var restoreErr error
			if outputExisted {
				restoreErr = writePrivateFileAtomically(outputPath, previousOutput)
			} else {
				restoreErr = os.Remove(outputPath)
				if os.IsNotExist(restoreErr) {
					restoreErr = nil
				}
			}
			if restoreErr != nil {
				return fmt.Errorf("同步 Lima 实例配置失败: %v；恢复主配置也失败: %w", err, restoreErr)
			}
			return fmt.Errorf("同步 Lima 实例配置失败: %w", err)
		}
	}

	return nil
}

// SyncAISkills creates the conventional per-user skill paths inside the VM.
// The host directory is mounted read-only by Lima; only symlinks owned by
// MacBox are created or removed, so an existing user directory is never
// overwritten.
func (m *Manager) SyncAISkills(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取 AI Skill 映射配置失败: %w", err)
	}
	hostPath, err := config.NormalizeAISkillsHostPath(cfgSnapshot.Terminal.AISkillsHostPath)
	if err != nil {
		return err
	}
	enabled := cfgSnapshot.Terminal.AISkillsEnabled
	if enabled {
		if hostPath == "" {
			return fmt.Errorf("AI Skill 映射已启用但未配置本机目录")
		}
		if info, statErr := os.Stat(hostPath); statErr != nil || !info.IsDir() {
			if statErr != nil {
				return fmt.Errorf("本机 AI Skill 目录不可用: %w", statErr)
			}
			return fmt.Errorf("本机 AI Skill 路径不是目录: %s", hostPath)
		}
	}

	guestSlug := m.guestProductSlug()
	guestUser := m.guestManagementUser()
	servicePath := "/etc/systemd/system/" + guestSlug + "-ai-skills.service"
	scriptPath := "/usr/local/bin/" + guestSlug + "-ai-skills.sh"
	var script string
	if enabled {
		linkScript := `#!/bin/bash
set -euo pipefail
SOURCE_PATH=/mnt/macbox-ai-skills
for i in $(seq 1 60); do
  if mountpoint -q "$SOURCE_PATH"; then
    break
  fi
  sleep 1
done
if ! mountpoint -q "$SOURCE_PATH" || [ ! -d "$SOURCE_PATH" ]; then
  echo "[macbox-ai-skills] source directory is not mounted: $SOURCE_PATH" >&2
  exit 1
fi

# Skill managers may expose an application root whose actual Skill folders
# live in a nested ./skills directory. Claude/Codex scan the mapped directory
# itself, so make the symlink target the directory that directly contains
# each <skill>/SKILL.md. This also keeps older VM configs working.
SKILL_ROOT="$SOURCE_PATH"
DIRECT_SKILL=$(find -L "$SKILL_ROOT" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print -quit)
if [ -z "$DIRECT_SKILL" ] && [ -d "$SOURCE_PATH/skills" ]; then
  SKILL_ROOT="$SOURCE_PATH/skills"
fi

ensure_parent_dir() {
  local dir_path="$1"
  local owner="$2"
  if [ ! -d "$dir_path" ]; then
    install -d -o "$owner" -g "$owner" -m 0755 "$dir_path"
  fi
}

ensure_parent_dir /home/macboxctl/.agents macboxctl
ensure_parent_dir /home/macboxctl/.claude macboxctl
ensure_parent_dir /home/macboxctl/.codex macboxctl
ensure_parent_dir /root/.agents root
ensure_parent_dir /root/.claude root
ensure_parent_dir /root/.codex root

ensure_skill_link() {
  local link_path="$1"
  if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then
    echo "[macbox-ai-skills] refusing to replace existing directory: $link_path" >&2
    return 1
  fi
  rm -f "$link_path"
  ln -s "$SKILL_ROOT" "$link_path"
}

ensure_skill_link /home/macboxctl/.agents/skills
ensure_skill_link /root/.agents/skills
ensure_skill_link /home/macboxctl/.claude/skills
ensure_skill_link /root/.claude/skills
ensure_skill_link /home/macboxctl/.codex/skills
ensure_skill_link /root/.codex/skills
`
		linkScript = strings.ReplaceAll(linkScript, "macboxctl", guestUser)
		linkScript = strings.ReplaceAll(linkScript, "macbox", guestSlug)
		serviceContent := `[Unit]
Description=MacBox AI CLI skills mapping
After=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/macbox-ai-skills.sh

[Install]
WantedBy=multi-user.target
`
		serviceContent = strings.ReplaceAll(serviceContent, "macbox", guestSlug)
		script = fmt.Sprintf(`
cat <<'SKILL_SCRIPT_EOF' > %s
%s
SKILL_SCRIPT_EOF
chmod 0755 %s

cat <<'SERVICE_EOF' > %s
[Unit]
%s
SERVICE_EOF

systemctl daemon-reload
systemctl enable macbox-ai-skills.service
systemctl restart macbox-ai-skills.service
`, scriptPath, linkScript, scriptPath, servicePath, serviceContent)
	} else {
		script = `#!/bin/bash
set -euo pipefail
remove_owned_link() {
  local link_path="$1"
  local target=""
  if [ -L "$link_path" ]; then
    target="$(readlink "$link_path")"
  fi
  if [ "$target" = "/mnt/macbox-ai-skills" ] || [ "$target" = "/mnt/macbox-ai-skills/skills" ]; then
    rm -f "$link_path"
  fi
}
remove_owned_link /home/macboxctl/.agents/skills
remove_owned_link /root/.agents/skills
remove_owned_link /home/macboxctl/.claude/skills
remove_owned_link /root/.claude/skills
remove_owned_link /home/macboxctl/.codex/skills
remove_owned_link /root/.codex/skills
if [ -f /etc/systemd/system/macbox-ai-skills.service ]; then
  systemctl disable --now macbox-ai-skills.service 2>/dev/null || true
  rm -f /etc/systemd/system/macbox-ai-skills.service
  rm -f /usr/local/bin/macbox-ai-skills.sh
  systemctl daemon-reload
fi
`
		script = strings.ReplaceAll(script, "macboxctl", guestUser)
		script = strings.ReplaceAll(script, "macbox", guestSlug)
	}

	// The command content is fixed and delivered through stdin. hostPath is
	// intentionally used only for validation; it never enters a shell command.
	if _, err := m.ExecWithInput(ctx, strings.NewReader(script), "sudo", "bash", "-s"); err != nil {
		return fmt.Errorf("同步 VM AI Skill 目录失败: %w", err)
	}
	return nil
}

func writePrivateFileAtomically(filePath string, data []byte) error {
	tmpFile, err := os.CreateTemp(filepath.Dir(filePath), ".macbox-private-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmpFile.Chmod(0600); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, filePath); err != nil {
		return err
	}
	return nil
}

// UpdateSpecs updates CPU, Memory, and DiskSize in the configuration and syncs to lima.yaml
func (m *Manager) UpdateSpecs(cpus, memory, diskSize int, projectRoot string) error {
	if cpus < 1 {
		cpus = 1
	}
	if memory < 2 {
		memory = 2
	}
	if diskSize < 10 {
		diskSize = 10
	}

	var previousCPUs, previousMemory, previousDiskSize int
	err := config.Update(m.cfg, func(updated *config.Config) error {
		previousCPUs = updated.VM.CPUs
		previousMemory = updated.VM.Memory
		previousDiskSize = updated.VM.DiskSize
		updated.VM.CPUs = cpus
		updated.VM.Memory = memory
		updated.VM.DiskSize = diskSize
		return nil
	})
	if err != nil {
		return fmt.Errorf("保存配置失败: %w", err)
	}

	cfgDir, err := config.ConfigDir()
	if err != nil {
		m.restoreSpecs(previousCPUs, previousMemory, previousDiskSize)
		return fmt.Errorf("创建配置目录失败: %w", err)
	}
	renderedYAML := filepath.Join(cfgDir, "macbox.yaml")
	tmplPath := filepath.Join(projectRoot, "templates", "vm", "macbox.yaml.tmpl")
	if err := m.GenerateConfigFile(tmplPath, renderedYAML); err != nil {
		m.restoreSpecs(previousCPUs, previousMemory, previousDiskSize)
		return fmt.Errorf("重新生成虚拟机配置文件失败: %w", err)
	}

	m.SetConfigDirty(true)
	m.InvalidateCache()
	return nil
}

func (m *Manager) restoreSpecs(cpus, memory, diskSize int) {
	if err := config.Update(m.cfg, func(updated *config.Config) error {
		updated.VM.CPUs = cpus
		updated.VM.Memory = memory
		updated.VM.DiskSize = diskSize
		return nil
	}); err != nil {
		m.mu.Lock()
		m.lastError = fmt.Sprintf("回滚虚拟机规格配置失败: %v", err)
		m.mu.Unlock()
	}
}

// Start launches the Lima VM
func (m *Manager) Start(ctx context.Context, projectRoot string) error {
	return m.StartWithProgress(ctx, projectRoot, nil)
}

// StartWithProgress launches the Lima VM and reports recoverable lifecycle
// checkpoints to the caller. The callback must be non-blocking; it is invoked
// from the operation goroutine and is normally backed by the job manager.
func (m *Manager) StartWithProgress(ctx context.Context, projectRoot string, report StartProgress) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if report != nil {
		report("checking", 5, "检查 Lima、数据盘和虚拟机配置")
	}
	m.InvalidateCache()
	err := m.startInternal(ctx, projectRoot)
	if err != nil {
		m.SetLastError(err.Error())
	} else {
		if report != nil {
			report("waiting-ssh", 45, "虚拟机已启动，等待 SSH 和系统服务就绪")
		}
		if accessErr := m.EnsureRuntimeAccess(ctx); accessErr != nil {
			err = accessErr
			m.SetLastError(accessErr.Error())
		} else if waitErr := waitForContext(ctx, 3*time.Second); waitErr != nil {
			err = waitErr
			m.SetLastError(waitErr.Error())
		} else {
			if report != nil {
				report("syncing-mounts", 75, "校验数据盘并同步本机目录直通")
			}
			m.SetLastError("")
			if syncErr := m.SyncMounts(ctx); syncErr != nil {
				log.Printf("[MacBox VM] mount sync failed after start: %v", syncErr)
				err = syncErr
				m.SetLastError(syncErr.Error())
			} else if skillsErr := m.SyncAISkills(ctx); skillsErr != nil {
				log.Printf("[MacBox VM] AI skills sync failed after start: %v", skillsErr)
				err = skillsErr
				m.SetLastError(skillsErr.Error())
			} else if report != nil {
				report("verifying-services", 92, "校验 Docker、文件服务和直通目录")
			}
		}
	}
	if err == nil && report != nil {
		report("completed", 100, "虚拟机和 MacBox 服务已就绪")
	}
	m.InvalidateCache()
	return err
}

// ProbeLocalMounts checks the full desired-vs-observed contract for every
// configured passthrough mount. A missing host folder or guest mount is
// returned as a health result rather than being hidden behind a generic 500.
func (m *Manager) ProbeLocalMounts(ctx context.Context) ([]LocalMountProbe, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return nil, fmt.Errorf("读取本地挂载配置失败: %w", err)
	}
	status, statusErr := m.GetStatusContext(ctx)
	if statusErr != nil {
		return nil, statusErr
	}
	probes := make([]LocalMountProbe, 0, len(cfgSnapshot.Storage.LocalMounts))
	for _, mount := range cfgSnapshot.Storage.LocalMounts {
		checkedAt := time.Now().UTC()
		probe := LocalMountProbe{
			ID:              mount.ID,
			HostPath:        mount.HostPath,
			GuestTarget:     mount.GuestTarget,
			ExpectedEnabled: mount.Enabled,
			CheckedAt:       checkedAt,
		}
		if !mount.Enabled {
			probe.Healthy = true
			probe.Status = "disabled"
			probe.Message = "已停用，等待启用后挂载"
			probes = append(probes, probe)
			continue
		}

		if info, statErr := os.Stat(mount.HostPath); statErr == nil && info.IsDir() {
			if directory, openErr := os.Open(mount.HostPath); openErr == nil {
				_ = directory.Close()
				probe.HostReady = true
			}
		}
		if !probe.HostReady {
			probe.Status = "host-missing"
			probe.Message = "本机目录不存在或当前进程无权读取"
			probes = append(probes, probe)
			continue
		}
		if status.Status != "Running" {
			probe.Status = "vm-stopped"
			probe.Message = "虚拟机未运行，暂时无法验证 Linux 挂载"
			probes = append(probes, probe)
			continue
		}

		mountID, idErr := config.NormalizeLocalMountID(mount.ID)
		if idErr != nil {
			probe.Status = "invalid-config"
			probe.Message = "直通目录 ID 配置无效"
			probes = append(probes, probe)
			continue
		}
		sourcePath := "/mnt/macbox-mounts/" + mountID
		if _, sourceErr := m.Exec(ctx, "mountpoint", "-q", sourcePath); sourceErr == nil {
			probe.SourceMounted = true
		}
		guestTarget, targetErr := config.NormalizeGuestTarget(mount.GuestTarget)
		if targetErr == nil {
			targetPath := "/data/" + guestTarget
			if _, targetMountErr := m.Exec(ctx, "mountpoint", "-q", targetPath); targetMountErr == nil {
				probe.TargetMounted = true
			}
		}
		probe.Healthy = probe.SourceMounted && probe.TargetMounted
		switch {
		case probe.Healthy:
			probe.Status = "healthy"
			probe.Message = "本机目录已挂载到 MacBox 目标目录"
		case !probe.SourceMounted:
			probe.Status = "source-missing"
			probe.Message = "Lima 未挂载本机目录，请确认配置已启用并重启虚拟机"
		case !probe.TargetMounted:
			probe.Status = "target-missing"
			probe.Message = "本机目录已进入虚拟机，但 /data 目标目录未完成绑定"
		}
		probes = append(probes, probe)
	}
	return probes, nil
}

// EnsureRuntimeAccess repairs the fixed Lima management account's
// supplementary groups. Lima can keep an existing shell session alive after
// usermod, so callers that need the new groups should use
// ExecAsManagementUser, which starts a fresh process with initgroups applied.
func (m *Manager) EnsureRuntimeAccess(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	out, err := m.Exec(ctx, "sudo", "usermod", "-aG", "docker,"+m.guestProductGroup(), m.guestManagementUser())
	if err != nil {
		return fmt.Errorf("修复 Lima 管理账号权限失败: %s (%w)", strings.TrimSpace(out), err)
	}
	if _, err := m.ExecAsManagementUser(ctx, "id"); err != nil {
		return fmt.Errorf("验证 Lima 管理账号权限失败: %w", err)
	}
	return nil
}

func (m *Manager) startInternal(ctx context.Context, projectRoot string) error {
	status, err := m.GetStatusContext(ctx)
	if err != nil {
		return err
	}

	if status.Status == "Running" {
		return nil
	}

	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("创建配置目录失败: %w", err)
	}
	renderedYAML := filepath.Join(cfgDir, "macbox.yaml")
	tmplPath := filepath.Join(projectRoot, "templates", "vm", "macbox.yaml.tmpl")
	if err := m.GenerateConfigFile(tmplPath, renderedYAML); err != nil {
		return fmt.Errorf("生成虚拟机配置文件失败: %w", err)
	}

	home, _ := os.UserHomeDir()
	instanceDir := filepath.Join(home, ".lima", m.instanceName)
	instanceExists := false
	if _, err := os.Stat(instanceDir); err == nil {
		instanceExists = true
	}

	if instanceExists || status.Status != "NotCreated" {
		if err := m.ValidateDataDiskContext(ctx); err != nil {
			return err
		}
		out, err := runHostCommand(ctx, "limactl", "start", m.instanceName, "--tty=false")
		if err != nil {
			return fmt.Errorf("limactl start failed: %s (%w)", out, err)
		}
		return nil
	}

	// Not created yet -> Create and Start
	if err := m.EnsureDataDiskContext(ctx, "50GiB"); err != nil {
		return fmt.Errorf("准备 Lima 数据盘失败: %w", err)
	}

	cfgDir, err = config.ConfigDir()
	if err != nil {
		return fmt.Errorf("创建配置目录失败: %w", err)
	}
	renderedYAML = filepath.Join(cfgDir, "macbox.yaml")
	tmplPath = filepath.Join(projectRoot, "templates", "vm", "macbox.yaml.tmpl")

	if err := m.GenerateConfigFile(tmplPath, renderedYAML); err != nil {
		return err
	}

	out, err := runHostCommand(ctx, "limactl", "start", renderedYAML, "--name", m.instanceName, "--tty=false")
	if err != nil {
		return fmt.Errorf("limactl start new instance failed: %s (%w)", out, err)
	}
	return nil
}

// Stop stops the Lima VM
func (m *Manager) Stop(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	m.InvalidateCache()
	out, err := runHostCommand(ctx, "limactl", "stop", m.instanceName)
	m.InvalidateCache()
	if err != nil {
		return fmt.Errorf("limactl stop failed: %s (%w)", out, err)
	}
	return nil
}

// Restart restarts the Lima VM
func (m *Manager) Restart(ctx context.Context, projectRoot string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	m.InvalidateCache()
	if err := m.Stop(ctx); err != nil {
		return fmt.Errorf("重启前停止虚拟机失败: %w", err)
	}
	if err := waitForContext(ctx, 2*time.Second); err != nil {
		return err
	}
	return m.Start(ctx, projectRoot)
}

func waitForContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// SyncMounts regenerates and re-applies VirtioFS bind mount script inside the running VM
func (m *Manager) SyncMounts(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	cfgSnapshot, err := config.Snapshot(m.cfg)
	if err != nil {
		return fmt.Errorf("读取本地挂载配置失败: %w", err)
	}
	mounts := cfgSnapshot.Storage.LocalMounts
	if len(mounts) == 0 {
		return nil
	}

	guestMountRoot := "/mnt/" + m.guestProductSlug() + "-mounts"
	// Build the mount script content
	script := "#!/bin/bash\nset -e\n" +
		"for i in $(seq 1 30); do\n" +
		"  REAL_DATA=\"$(readlink -f /data || true)\"\n" +
		"  if [ -n \"$REAL_DATA\" ] && [ -d \"$REAL_DATA\" ]; then\n" +
		"    break\n" +
		"  fi\n" +
		"  sleep 1\n" +
		"done\n" +
		"if [ -z \"$REAL_DATA\" ] || [ ! -d \"$REAL_DATA\" ]; then\n" +
		"  echo \"[macbox-mounts] /data is not ready\" >&2\n" +
		"  exit 1\n" +
		"fi\n"

	for _, mount := range mounts {
		if _, err := config.NormalizeLocalMountID(mount.ID); err != nil {
			return fmt.Errorf("本地挂载 %q 配置无效: %w", mount.ID, err)
		}
		if !mount.Enabled {
			continue
		}
		mode := "ro"
		if mount.Writable {
			mode = "rw"
		}
		sourcePath := guestMountRoot + "/" + mount.ID
		guestTarget, err := config.NormalizeGuestTarget(mount.GuestTarget)
		if err != nil {
			return fmt.Errorf("本地挂载 %q 配置无效: %w", mount.ID, err)
		}
		script += fmt.Sprintf(
			"SOURCE_PATH=%s\n"+
				"for i in $(seq 1 60); do\n"+
				"  if mountpoint -q \"$SOURCE_PATH\"; then\n"+
				"    break\n"+
				"  fi\n"+
				"  sleep 1\n"+
				"done\n"+
				"if ! mountpoint -q \"$SOURCE_PATH\"; then\n"+
				"  echo \"[macbox-mounts] source is not ready: $SOURCE_PATH\" >&2\n"+
				"  exit 1\n"+
				"fi\n"+
				"mount -o remount,%s \"$SOURCE_PATH\" 2>/dev/null || true\n"+
				"REAL_DATA=\"$(readlink -f /data || echo /data)\"\n"+
				"TARGET_DIR=\"$REAL_DATA\"/%s\n"+
				"mkdir -p \"$TARGET_DIR\"\n"+
				// A previous Lima configuration may have mounted the host folder
				// directly at TARGET_DIR. Lima-owned VirtioFS mounts cannot always be
				// unmounted from inside the guest; layer our bind mount over it so the
				// configured source still becomes visible instead of treating the
				// stale mount as success.
				"if mountpoint -q \"$TARGET_DIR\"; then\n"+
				"  umount \"$TARGET_DIR\" 2>/dev/null || true\n"+
				"fi\n"+
				"# If an old Lima-managed mount remains, bind over it. On the next run\n"+
				"# the top bind layer is removed first and then recreated exactly once.\n"+
				"mount --bind \"$SOURCE_PATH\" \"$TARGET_DIR\"\n"+
				"echo \"[macbox-mounts] bind mounted %s -> $TARGET_DIR\"\n"+
				"mount -o remount,%s \"$TARGET_DIR\" 2>/dev/null || true\n",
			shellQuote(sourcePath), mode, shellQuote(guestTarget), shellQuote(mount.ID), mode,
		)
	}

	serviceContent := `[Unit]
Description=MacBox VirtioFS bind mounts
# Keep this service independent from cloud-init's final target. On Ubuntu,
# cloud-init.target is ordered after multi-user.target, so making a
# multi-user service depend on it creates a boot cycle and blocks limactl.
After=local-fs.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/macbox-mounts.sh

[Install]
WantedBy=multi-user.target`
	serviceContent = strings.ReplaceAll(serviceContent, "macbox", m.guestProductSlug())
	mountScriptPath := "/usr/local/bin/" + m.guestProductSlug() + "-mounts.sh"
	servicePath := "/etc/systemd/system/" + m.guestProductSlug() + "-mounts.service"
	serviceName := m.guestProductSlug() + "-mounts.service"
	script = strings.ReplaceAll(script, "macbox", m.guestProductSlug())

	// Write each payload through stdin. This keeps both configuration content and
	// mount values out of shell command interpolation.
	if _, err := m.Exec(ctx, "sudo", "mkdir", "-p", guestMountRoot); err != nil {
		return fmt.Errorf("准备本地挂载目录失败: %w", err)
	}
	if _, err := m.ExecWithInput(ctx, strings.NewReader(script), "sudo", "tee", mountScriptPath); err != nil {
		return fmt.Errorf("写入本地挂载脚本失败: %w", err)
	}
	if _, err := m.Exec(ctx, "sudo", "chmod", "+x", mountScriptPath); err != nil {
		return fmt.Errorf("设置本地挂载脚本权限失败: %w", err)
	}
	if _, err := m.ExecWithInput(ctx, strings.NewReader(serviceContent), "sudo", "tee", servicePath); err != nil {
		return fmt.Errorf("写入本地挂载服务失败: %w", err)
	}
	if _, err := m.Exec(ctx, "sudo", "systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("刷新本地挂载服务失败: %w", err)
	}
	if _, err := m.Exec(ctx, "sudo", "systemctl", "enable", serviceName); err != nil {
		return fmt.Errorf("启用本地挂载服务失败: %w", err)
	}
	if out, err := m.Exec(ctx, "sudo", mountScriptPath); err != nil {
		return fmt.Errorf("执行本地挂载脚本失败: %s (%w)", strings.TrimSpace(out), err)
	}
	return nil
}

// shellQuote returns a POSIX single-quoted literal for the generated mount
// helper script. It is only used while producing the script file; the script
// itself is delivered via stdin rather than embedded in a command line.
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func yamlQuote(value string) string {
	data, err := yaml.Marshal(value)
	if err != nil {
		return `""`
	}
	return strings.TrimSpace(string(data))
}

const maxVMCommandOutputBytes = 8 << 20

// cappedCommandOutput protects the control plane from commands whose output
// is unexpectedly large (for example, a noisy Docker/Compose operation). It
// reports the full write length to exec.Cmd so the child keeps running, while
// retaining only a bounded diagnostic prefix.
type cappedCommandOutput struct {
	mu        sync.Mutex
	buf       bytes.Buffer
	truncated bool
}

func (b *cappedCommandOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	remaining := maxVMCommandOutputBytes - b.buf.Len()
	if remaining > 0 {
		if len(p) <= remaining {
			_, _ = b.buf.Write(p)
		} else {
			_, _ = b.buf.Write(p[:remaining])
			b.truncated = true
		}
	} else if len(p) > 0 {
		b.truncated = true
	}
	return len(p), nil
}

func (b *cappedCommandOutput) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	output := b.buf.String()
	if b.truncated {
		output += fmt.Sprintf("\n[MacBox] 命令输出已截断（超过 %d MiB）\n", maxVMCommandOutputBytes/(1<<20))
	}
	return output
}

func runVMCommand(ctx context.Context, instanceName string, stdin io.Reader, command ...string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	args := append([]string{"shell", instanceName}, command...)
	cmd := exec.CommandContext(ctx, limaCommandPath(), args...)
	cmd.Stdin = stdin
	var output cappedCommandOutput
	cmd.Stdout = &output
	cmd.Stderr = &output
	err := cmd.Run()
	return output.String(), err
}

func runHostCommand(ctx context.Context, name string, args ...string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	cmd := exec.CommandContext(ctx, resolveCommandPath(name), args...)
	var output cappedCommandOutput
	cmd.Stdout = &output
	cmd.Stderr = &output
	err := cmd.Run()
	return output.String(), err
}

func resolveCommandPath(name string) string {
	if name == "limactl" {
		return limaCommandPath()
	}
	return name
}

func limaCommandPath() string {
	if path, ok := FindLima(); ok {
		return path
	}
	return "limactl"
}

// Exec runs a command inside the Lima VM via limactl shell
func (m *Manager) Exec(ctx context.Context, command ...string) (string, error) {
	return runVMCommand(ctx, m.InstanceName(), nil, m.managementCommandArgs(command...)...)
}

// ExecAsManagementUser runs a command in a fresh process for the fixed Lima
// management account. sudo -u refreshes supplementary groups without sudo -i's
// login-shell argument rewriting, which would corrupt multiline scripts.
func (m *Manager) ExecAsManagementUser(ctx context.Context, command ...string) (string, error) {
	return m.Exec(ctx, command...)
}

// ExecWithInput runs a command inside the Lima VM and streams input to its
// stdin. This is used for passwords and file contents so they never need to
// be interpolated into a shell command.
func (m *Manager) ExecWithInput(ctx context.Context, stdin io.Reader, command ...string) (string, error) {
	return runVMCommand(ctx, m.InstanceName(), stdin, m.managementCommandArgs(command...)...)
}

// ExecStream runs a command inside the Lima VM and streams stdout/stderr to an io.Writer
func (m *Manager) ExecStream(ctx context.Context, w io.Writer, command ...string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	args := append([]string{"shell", m.InstanceName()}, m.managementCommandArgs(command...)...)
	cmd := exec.CommandContext(ctx, limaCommandPath(), args...)
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

// ExecStreamWithInput is the streaming counterpart to ExecWithInput.
func (m *Manager) ExecStreamWithInput(ctx context.Context, w io.Writer, stdin io.Reader, command ...string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	args := append([]string{"shell", m.InstanceName()}, m.managementCommandArgs(command...)...)
	cmd := exec.CommandContext(ctx, limaCommandPath(), args...)
	cmd.Stdin = stdin
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

func (m *Manager) managementCommandArgs(command ...string) []string {
	return append([]string{"sudo", "-u", m.guestManagementUser(), "--"}, command...)
}
