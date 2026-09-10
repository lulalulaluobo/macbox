package vm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"net"
	"os"
	"os/exec"
	"path/filepath"
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

// GetStatus checks Lima for the current status of the MacNAS instance
func (m *Manager) GetStatus() (*VMStatus, error) {
	cmd := exec.Command("limactl", "list", "--json")
	output, err := cmd.Output()
	if err != nil {
		// limactl might fail or no instances
		return &VMStatus{
			Name:        m.instanceName,
			Status:      "NotCreated",
			UpdatedAt:   time.Now(),
			DockerReady: false,
		}, nil
	}

	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		var inst LimaInstanceJSON
		if err := json.Unmarshal([]byte(line), &inst); err == nil {
			if inst.Name == m.instanceName {
				sock := m.GetDockerSocketPath(inst.Dir)
				ready := m.IsSocketReady(sock)

				return &VMStatus{
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
					Errors:       inst.Errors,
					UpdatedAt:    time.Now(),
				}, nil
			}
		}
	}

	return &VMStatus{
		Name:        m.instanceName,
		Status:      "NotCreated",
		UpdatedAt:   time.Now(),
		DockerReady: false,
	}, nil
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
	}{
		CPUs:          m.cfg.VM.CPUs,
		Memory:        m.cfg.VM.Memory,
		DiskSize:      m.cfg.VM.DiskSize,
		DataDiskName:  m.cfg.VM.DataDiskName,
		SambaPassword: m.cfg.Samba.Password,
		SambaPort:     m.cfg.Samba.Port,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return fmt.Errorf("execute vm template error: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return err
	}

	return os.WriteFile(outputPath, buf.Bytes(), 0644)
}

// Start launches the Lima VM
func (m *Manager) Start(ctx context.Context, projectRoot string) error {
	status, err := m.GetStatus()
	if err != nil {
		return err
	}

	if status.Status == "Running" {
		return nil
	}

	if status.Status == "Stopped" {
		cmd := exec.CommandContext(ctx, "limactl", "start", m.instanceName, "--tty=false")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("limactl start failed: %s (%w)", string(out), err)
		}
		return nil
	}

	// Not created yet -> Create and Start
	_ = m.EnsureDataDisk("50GiB")

	cfgDir, _ := config.ConfigDir()
	renderedYAML := filepath.Join(cfgDir, "macnas.yaml")
	tmplPath := filepath.Join(projectRoot, "templates", "vm", "macnas.yaml.tmpl")

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
	cmd := exec.CommandContext(ctx, "limactl", "stop", m.instanceName)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("limactl stop failed: %s (%w)", string(out), err)
	}
	return nil
}

// Restart restarts the Lima VM
func (m *Manager) Restart(ctx context.Context, projectRoot string) error {
	_ = m.Stop(ctx)
	time.Sleep(2 * time.Second)
	return m.Start(ctx, projectRoot)
}

// Exec runs a command inside the Lima VM via limactl shell
func (m *Manager) Exec(ctx context.Context, command ...string) (string, error) {
	args := append([]string{"shell", m.instanceName}, command...)
	cmd := exec.CommandContext(ctx, "limactl", args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}
