package docker

import (
	"context"
	"os/exec"

	"github.com/luluen/mac-nas/pkg/vm"
)

type Client struct {
	vmMgr       *vm.Manager
	projectRoot string
}

func NewClient(vmMgr *vm.Manager, projectRoot ...string) *Client {
	root := ""
	if len(projectRoot) > 0 {
		root = projectRoot[0]
	}
	return &Client{
		vmMgr:       vmMgr,
		projectRoot: root,
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

func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok {
		if s, ok := val.(string); ok {
			return s
		}
	}
	return ""
}
