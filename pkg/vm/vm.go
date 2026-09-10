package vm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"text/template"
	"time"

	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/storage"
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
	lastError    string
	vmAction     string // "starting", "stopping", "restarting", "" (idle)
	configDirty  bool   // true when config changed and VM needs restart
	cachedStatus *VMStatus
	cachedAt     time.Time
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

func (m *Manager) GetVMAction() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.vmAction
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

func NewManager(cfg *config.Config) *Manager {
	name := cfg.VM.Name
	if name == "" {
		name = "macnas"
	}
	return &Manager{
		cfg:          cfg,
		instanceName: name,
	}
}

// GetStatus checks Lima for the current status of the MacNAS instance (cached with 3s TTL)
func (m *Manager) GetStatus() (*VMStatus, error) {
	m.mu.RLock()
	if m.cachedStatus != nil && time.Since(m.cachedAt) < 3*time.Second {
		cpy := *m.cachedStatus
		m.mu.RUnlock()
		return &cpy, nil
	}
	m.mu.RUnlock()

	cmd := exec.Command("limactl", "list", "--json")
	output, err := cmd.Output()
	if err != nil {
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
		return res, nil
	}

	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		var inst LimaInstanceJSON
		if err := json.Unmarshal([]byte(line), &inst); err == nil {
			if inst.Name == m.instanceName {
				sock := m.GetDockerSocketPath(inst.Dir)
				ready := m.IsSocketReady(sock)

				errs := inst.Errors
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
				return res, nil
			}
		}
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
	return res, nil
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
	diskName := m.cfg.VM.DataDiskName
	if diskName == "" {
		diskName = "macnas-data"
	}
	disks, err := storage.ListManagedDisks()
	if err == nil {
		for _, d := range disks {
			if d.Name == diskName {
				return nil // already exists
			}
		}
	}

	if size == "" {
		size = "50GiB"
	}
	return storage.CreateManagedDisk(diskName, size)
}

// GenerateConfig renders templates/vm/macnas.yaml.tmpl into ~/.macnas/macnas.yaml
func (m *Manager) GenerateConfigFile(tmplPath, outputPath string) error {
	tmplData, err := os.ReadFile(tmplPath)
	if err != nil {
		return fmt.Errorf("read vm template error: %w", err)
	}

	tmpl, err := template.New("macnas-vm").Parse(string(tmplData))
	if err != nil {
		return fmt.Errorf("parse vm template error: %w", err)
	}

	data := struct {
		CPUs          int
		Memory        int
		DiskSize      int
		DataDiskName  string
		SambaPassword string
		SambaPort     int
		LocalMounts   []config.LocalMount
	}{
		CPUs:          m.cfg.VM.CPUs,
		Memory:        m.cfg.VM.Memory,
		DiskSize:      m.cfg.VM.DiskSize,
		DataDiskName:  m.cfg.VM.DataDiskName,
		SambaPassword: m.cfg.Samba.Password,
		SambaPort:     m.cfg.Samba.Port,
		LocalMounts:   m.cfg.Storage.LocalMounts,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return fmt.Errorf("execute vm template error: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return err
	}

	if err := os.WriteFile(outputPath, buf.Bytes(), 0644); err != nil {
		return err
	}

	// Also sync to ~/.lima/<instance>/lima.yaml if instance directory exists
	home, err := os.UserHomeDir()
	if err == nil {
		instanceDir := filepath.Join(home, ".lima", m.instanceName)
		if _, err := os.Stat(instanceDir); err == nil {
			_ = os.WriteFile(filepath.Join(instanceDir, "lima.yaml"), buf.Bytes(), 0644)
		}
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

	m.cfg.VM.CPUs = cpus
	m.cfg.VM.Memory = memory
	m.cfg.VM.DiskSize = diskSize

	if err := config.SaveConfig(m.cfg); err != nil {
		return fmt.Errorf("保存配置失败: %w", err)
	}

	cfgDir, _ := config.ConfigDir()
	renderedYAML := filepath.Join(cfgDir, "macnas.yaml")
	tmplPath := filepath.Join(projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	if err := m.GenerateConfigFile(tmplPath, renderedYAML); err != nil {
		return fmt.Errorf("重新生成虚拟机配置文件失败: %w", err)
	}

	m.SetConfigDirty(true)
	m.InvalidateCache()
	return nil
}

// Start launches the Lima VM
func (m *Manager) Start(ctx context.Context, projectRoot string) error {
	m.InvalidateCache()
	err := m.startInternal(ctx, projectRoot)
	if err != nil {
		m.SetLastError(err.Error())
	} else {
		m.SetLastError("")
		time.Sleep(3 * time.Second)
		m.SyncMounts(ctx)
	}
	m.InvalidateCache()
	return err
}

func (m *Manager) startInternal(ctx context.Context, projectRoot string) error {
	status, err := m.GetStatus()
	if err != nil {
		return err
	}

	if status.Status == "Running" {
		return nil
	}

	cfgDir, _ := config.ConfigDir()
	renderedYAML := filepath.Join(cfgDir, "macnas.yaml")
	tmplPath := filepath.Join(projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	_ = m.GenerateConfigFile(tmplPath, renderedYAML)

	home, _ := os.UserHomeDir()
	instanceDir := filepath.Join(home, ".lima", m.instanceName)
	instanceExists := false
	if _, err := os.Stat(instanceDir); err == nil {
		instanceExists = true
	}

	if instanceExists || status.Status != "NotCreated" {
		cmd := exec.CommandContext(ctx, "limactl", "start", m.instanceName, "--tty=false")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("limactl start failed: %s (%w)", string(out), err)
		}
		return nil
	}

	// Not created yet -> Create and Start
	_ = m.EnsureDataDisk("50GiB")

	cfgDir, _ = config.ConfigDir()
	renderedYAML = filepath.Join(cfgDir, "macnas.yaml")
	tmplPath = filepath.Join(projectRoot, "templates", "vm", "macnas.yaml.tmpl")

	if err := m.GenerateConfigFile(tmplPath, renderedYAML); err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "limactl", "start", renderedYAML, "--name", m.instanceName, "--tty=false")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("limactl start new instance failed: %s (%w)", string(out), err)
	}
	return nil
}

// Stop stops the Lima VM
func (m *Manager) Stop(ctx context.Context) error {
	m.InvalidateCache()
	cmd := exec.CommandContext(ctx, "limactl", "stop", m.instanceName)
	out, err := cmd.CombinedOutput()
	m.InvalidateCache()
	if err != nil {
		return fmt.Errorf("limactl stop failed: %s (%w)", string(out), err)
	}
	return nil
}

// Restart restarts the Lima VM
func (m *Manager) Restart(ctx context.Context, projectRoot string) error {
	m.InvalidateCache()
	_ = m.Stop(ctx)
	time.Sleep(2 * time.Second)
	return m.Start(ctx, projectRoot)
}

// SyncMounts regenerates and re-applies VirtioFS bind mount script inside the running VM
func (m *Manager) SyncMounts(ctx context.Context) {
	if len(m.cfg.Storage.LocalMounts) == 0 {
		return
	}

	// Build the mount script content
	script := "#!/bin/bash\nset -e\nsleep 1\n"
	for _, mount := range m.cfg.Storage.LocalMounts {
		if !mount.Enabled {
			continue
		}
		script += fmt.Sprintf(
			"if [ -d \"/mnt/macnas-mounts/%s\" ]; then\n"+
				"  mkdir -p \"/data/%s\"\n"+
				"  mountpoint -q \"/data/%s\" || mount --bind \"/mnt/macnas-mounts/%s\" \"/data/%s\"\n"+
				"  echo \"[macnas-mounts] mounted %s -> /data/%s\"\n"+
				"fi\n",
			mount.ID, mount.GuestTarget, mount.GuestTarget, mount.ID, mount.GuestTarget,
			mount.ID, mount.GuestTarget,
		)
	}

	serviceContent := `[Unit]
Description=MacNAS VirtioFS bind mounts
After=local-fs.target docker.service
Wants=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/macnas-mounts.sh

[Install]
WantedBy=multi-user.target`

	// Write script, install systemd service if missing/updated, and execute
	setupCmd := fmt.Sprintf(
		"mkdir -p /mnt/macnas-mounts && "+
			"cat > /usr/local/bin/macnas-mounts.sh << 'SCRIPT_EOF'\n%s\nSCRIPT_EOF\n"+
			"chmod +x /usr/local/bin/macnas-mounts.sh && "+
			"cat > /etc/systemd/system/macnas-mounts.service << 'SERVICE_EOF'\n%s\nSERVICE_EOF\n"+
			"systemctl daemon-reload && "+
			"systemctl enable macnas-mounts.service && "+
			"/usr/local/bin/macnas-mounts.sh || true",
		script, serviceContent,
	)
	_, _ = m.Exec(ctx, "sudo", "bash", "-c", setupCmd)
}


// Exec runs a command inside the Lima VM via limactl shell
func (m *Manager) Exec(ctx context.Context, command ...string) (string, error) {
	args := append([]string{"shell", m.instanceName}, command...)
	cmd := exec.CommandContext(ctx, "limactl", args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// ExecStream runs a command inside the Lima VM and streams stdout/stderr to an io.Writer
func (m *Manager) ExecStream(ctx context.Context, w io.Writer, command ...string) error {
	args := append([]string{"shell", m.instanceName}, command...)
	cmd := exec.CommandContext(ctx, "limactl", args...)
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}
