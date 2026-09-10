package apps

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/luluen/mac-nas/pkg/docker"
	"github.com/luluen/mac-nas/pkg/vm"
)

type AppVolume struct {
	Host      string `json:"host"`
	Container string `json:"container"`
}

type AppMetadata struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Version     string      `json:"version"`
	Icon        string      `json:"icon"`
	Category    string      `json:"category"`
	Port        int         `json:"port"`
	WebURL      string      `json:"webUrl"`
	Volumes     []AppVolume `json:"volumes"`
	Status      string      `json:"status"` // "not_installed", "running", "stopped", "error"
	Installed   bool        `json:"installed"`
}

type Manager struct {
	vmMgr        *vm.Manager
	dockerClient *docker.Client
	projectRoot  string
}

func NewManager(vmMgr *vm.Manager, dockerClient *docker.Client, projectRoot string) *Manager {
	return &Manager{
		vmMgr:        vmMgr,
		dockerClient: dockerClient,
		projectRoot:  projectRoot,
	}
}

var presetAppIDs = []string{"jellyfin", "syncthing", "filebrowser"}

func (m *Manager) ListApps(ctx context.Context, hostIP string) ([]AppMetadata, error) {
	containers, _ := m.dockerClient.ListContainers(ctx)
	containerMap := make(map[string]docker.ContainerInfo)
	for _, c := range containers {
		containerMap[c.Names] = c
	}

	var results []AppMetadata
	for _, id := range presetAppIDs {
		appMeta, err := m.loadAppMetadata(id)
		if err != nil {
			continue
		}

		// Replace HostIP in WebURL
		if hostIP == "" {
			hostIP = "localhost"
		}
		appMeta.WebURL = strings.ReplaceAll(appMeta.WebURL, "{{.HostIP}}", hostIP)

		// Check if container exists
		containerName := "macnas-" + id
		if c, exists := containerMap[containerName]; exists {
			appMeta.Installed = true
			if c.State == "running" {
				appMeta.Status = "running"
			} else {
				appMeta.Status = "stopped"
			}
		} else {
			// Check if compose file exists inside VM
			checkCmd := fmt.Sprintf("[ -f /data/appdata/%s/compose.yaml ] && echo 'exists'", id)
			out, _ := m.vmMgr.Exec(ctx, "bash", "-c", checkCmd)
			if strings.Contains(out, "exists") {
				appMeta.Installed = true
				appMeta.Status = "stopped"
			} else {
				appMeta.Installed = false
				appMeta.Status = "not_installed"
			}
		}

		results = append(results, *appMeta)
	}

	return results, nil
}

func (m *Manager) loadAppMetadata(id string) (*AppMetadata, error) {
	metaPath := filepath.Join(m.projectRoot, "templates", "apps", id, "app.json")
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, err
	}

	var meta AppMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

func (m *Manager) Install(ctx context.Context, id string) error {
	composePath := filepath.Join(m.projectRoot, "templates", "apps", id, "compose.yaml")
	composeData, err := os.ReadFile(composePath)
	if err != nil {
		return fmt.Errorf("read template compose error: %w", err)
	}

	// 1. Create appdata dir in VM
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	mkdirCmd := fmt.Sprintf("mkdir -p %s /data/media /data/files", appDataDir)
	if _, err := m.vmMgr.Exec(ctx, "bash", "-c", mkdirCmd); err != nil {
		return fmt.Errorf("failed to create app directories: %w", err)
	}

	// 2. Write compose.yaml into VM
	encodedYAML := strings.ReplaceAll(string(composeData), "'", "'\\''")
	writeCmd := fmt.Sprintf("cat <<'EOF' > %s/compose.yaml\n%s\nEOF", appDataDir, encodedYAML)
	if _, err := m.vmMgr.Exec(ctx, "bash", "-c", writeCmd); err != nil {
		return fmt.Errorf("failed to write compose.yaml inside VM: %w", err)
	}

	// 3. Run docker compose up -d inside VM
	upCmd := fmt.Sprintf("docker compose -f %s/compose.yaml up -d", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", upCmd)
	if err != nil {
		return fmt.Errorf("docker compose up failed: %s (%w)", out, err)
	}

	return nil
}

func (m *Manager) Start(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	upCmd := fmt.Sprintf("docker compose -f %s/compose.yaml start", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", upCmd)
	if err != nil {
		return fmt.Errorf("docker compose start failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Stop(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	upCmd := fmt.Sprintf("docker compose -f %s/compose.yaml stop", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", upCmd)
	if err != nil {
		return fmt.Errorf("docker compose stop failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Restart(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	upCmd := fmt.Sprintf("docker compose -f %s/compose.yaml restart", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", upCmd)
	if err != nil {
		return fmt.Errorf("docker compose restart failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Uninstall(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	downCmd := fmt.Sprintf("docker compose -f %s/compose.yaml down -v", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", downCmd)
	if err != nil {
		return fmt.Errorf("docker compose down failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) GetLogs(ctx context.Context, id string, tail int) (string, error) {
	if tail <= 0 {
		tail = 100
	}
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	logsCmd := fmt.Sprintf("docker compose -f %s/compose.yaml logs --tail=%d", appDataDir, tail)
	return m.vmMgr.Exec(ctx, "bash", "-c", logsCmd)
}
