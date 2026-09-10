package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (c *Client) ListNetworks(ctx context.Context) ([]DockerNetwork, error) {
	out, err := c.runDockerCmd(ctx, "network", "ls", "--format", "{{json .}}")
	if err != nil {
		return nil, fmt.Errorf("failed to list networks: %w", err)
	}

	var networks []DockerNetwork
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			id := getString(raw, "ID")
			name := getString(raw, "Name")
			driver := getString(raw, "Driver")
			scope := getString(raw, "Scope")
			ipv4 := getString(raw, "IPv4")
			internalStr := strings.ToLower(getString(raw, "Internal"))
			createdAt := getString(raw, "CreatedAt")

			networks = append(networks, DockerNetwork{
				ID:        id,
				Name:      name,
				Driver:    driver,
				Scope:     scope,
				IPv4:      ipv4,
				Internal:  internalStr == "true",
				CreatedAt: createdAt,
			})
		}
	}

	return networks, nil
}

func (c *Client) GetRegistryMirrors(ctx context.Context) ([]string, error) {
	out, _ := c.vmMgr.Exec(ctx, "bash", "-c", "cat /etc/docker/daemon.json 2>/dev/null")
	if strings.TrimSpace(out) == "" {
		return []string{}, nil
	}

	var daemonConfig struct {
		RegistryMirrors []string `json:"registry-mirrors"`
	}
	if err := json.Unmarshal([]byte(out), &daemonConfig); err == nil {
		return daemonConfig.RegistryMirrors, nil
	}
	return []string{}, nil
}

func (c *Client) SetRegistryMirrors(ctx context.Context, mirrors []string) error {
	out, _ := c.vmMgr.Exec(ctx, "bash", "-c", "cat /etc/docker/daemon.json 2>/dev/null")
	var daemonConfig map[string]interface{}
	if strings.TrimSpace(out) != "" {
		_ = json.Unmarshal([]byte(out), &daemonConfig)
	}
	if daemonConfig == nil {
		daemonConfig = make(map[string]interface{})
	}

	daemonConfig["registry-mirrors"] = mirrors
	data, err := json.MarshalIndent(daemonConfig, "", "  ")
	if err != nil {
		return err
	}

	encoded := strings.ReplaceAll(string(data), "'", "'\\''")
	writeCmd := fmt.Sprintf("sudo mkdir -p /etc/docker && sudo bash -c \"cat <<'EOF' > /etc/docker/daemon.json\n%s\nEOF\" && sudo systemctl reload docker", encoded)
	_, err = c.vmMgr.Exec(ctx, "bash", "-c", writeCmd)
	return err
}
