package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/luluen/mac-nas/pkg/vm"
)

type ContainerInfo struct {
	ID        string `json:"id"`
	Names     string `json:"name"`
	Image     string `json:"image"`
	State     string `json:"state"` // "running", "exited", "created", etc.
	Status    string `json:"status"`
	Ports     string `json:"ports"`
	CreatedAt string `json:"createdAt"`
}

type Client struct {
	vmMgr *vm.Manager
}

func NewClient(vmMgr *vm.Manager) *Client {
	return &Client{
		vmMgr: vmMgr,
	}
}

func (c *Client) runDockerCmd(ctx context.Context, args ...string) ([]byte, error) {
	status, _ := c.vmMgr.GetStatus()
	// If host docker socket is ready and host docker cli is available, run directly
	if status.DockerReady {
		cmdArgs := append([]string{"-H", "unix://" + status.DockerSocket}, args...)
		cmd := exec.CommandContext(ctx, "docker", cmdArgs...)
		out, err := cmd.CombinedOutput()
		if err == nil {
			return out, nil
		}
	}

	// Fallback to running inside VM
	vmArgs := append([]string{"docker"}, args...)
	out, err := c.vmMgr.Exec(ctx, vmArgs...)
	return []byte(out), err
}

func (c *Client) ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	out, err := c.runDockerCmd(ctx, "ps", "-a", "--format", "{{json .}}")
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var containers []ContainerInfo
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			c := ContainerInfo{
				ID:        getString(raw, "ID"),
				Names:     getString(raw, "Names"),
				Image:     getString(raw, "Image"),
				State:     strings.ToLower(getString(raw, "State")),
				Status:    getString(raw, "Status"),
				Ports:     getString(raw, "Ports"),
				CreatedAt: getString(raw, "CreatedAt"),
			}
			// remove leading / from name if present
			c.Names = strings.TrimPrefix(c.Names, "/")
			containers = append(containers, c)
		}
	}

	return containers, nil
}

func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok {
		if s, ok := val.(string); ok {
			return s
		}
	}
	return ""
}

func (c *Client) StartContainer(ctx context.Context, idOrName string) error {
	_, err := c.runDockerCmd(ctx, "start", idOrName)
	return err
}

func (c *Client) StopContainer(ctx context.Context, idOrName string) error {
	_, err := c.runDockerCmd(ctx, "stop", idOrName)
	return err
}

func (c *Client) RestartContainer(ctx context.Context, idOrName string) error {
	_, err := c.runDockerCmd(ctx, "restart", idOrName)
	return err
}

func (c *Client) GetLogs(ctx context.Context, idOrName string, tail int) (string, error) {
	if tail <= 0 {
		tail = 100
	}
	out, err := c.runDockerCmd(ctx, "logs", fmt.Sprintf("--tail=%d", tail), idOrName)
	return string(out), err
}
