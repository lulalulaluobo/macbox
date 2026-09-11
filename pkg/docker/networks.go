package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

const (
	maxRegistryMirrors      = 20
	maxRegistryMirrorLength = 512
)

func normalizeRegistryMirrors(mirrors []string) ([]string, error) {
	if len(mirrors) > maxRegistryMirrors {
		return nil, fmt.Errorf("镜像加速地址不能超过 %d 个", maxRegistryMirrors)
	}
	result := make([]string, 0, len(mirrors))
	seen := make(map[string]struct{}, len(mirrors))
	for _, mirror := range mirrors {
		mirror = strings.TrimSpace(mirror)
		if mirror == "" {
			continue
		}
		if len([]byte(mirror)) > maxRegistryMirrorLength || strings.ContainsAny(mirror, "\r\n\x00") {
			return nil, fmt.Errorf("镜像加速地址格式无效")
		}
		parsed, err := url.Parse(mirror)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, fmt.Errorf("镜像加速地址必须是无账号密码的 HTTP(S) 地址")
		}
		mirror = strings.TrimRight(mirror, "/")
		if _, exists := seen[mirror]; exists {
			continue
		}
		seen[mirror] = struct{}{}
		result = append(result, mirror)
	}
	return result, nil
}

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
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取网络列表失败: %w", err)
	}

	return networks, nil
}

func (c *Client) GetRegistryMirrors(ctx context.Context) ([]string, error) {
	out, err := c.vmMgr.Exec(ctx, "cat", "/etc/docker/daemon.json")
	if err != nil && strings.TrimSpace(out) != "" {
		return nil, fmt.Errorf("读取 Docker 配置失败: %w", err)
	}
	if strings.TrimSpace(out) == "" {
		return []string{}, nil
	}

	var daemonConfig struct {
		RegistryMirrors []string `json:"registry-mirrors"`
	}
	if err := json.Unmarshal([]byte(out), &daemonConfig); err != nil {
		return nil, fmt.Errorf("Docker 配置 JSON 无效: %w", err)
	}
	return normalizeRegistryMirrors(daemonConfig.RegistryMirrors)
}

func (c *Client) SetRegistryMirrors(ctx context.Context, mirrors []string) error {
	normalizedMirrors, err := normalizeRegistryMirrors(mirrors)
	if err != nil {
		return err
	}

	out, readErr := c.vmMgr.Exec(ctx, "cat", "/etc/docker/daemon.json")
	if readErr != nil && strings.TrimSpace(out) != "" {
		return fmt.Errorf("读取 Docker 配置失败: %w", readErr)
	}
	var daemonConfig map[string]interface{}
	if strings.TrimSpace(out) != "" {
		if err := json.Unmarshal([]byte(out), &daemonConfig); err != nil {
			return fmt.Errorf("Docker 配置 JSON 无效: %w", err)
		}
	}
	if daemonConfig == nil {
		daemonConfig = make(map[string]interface{})
	}

	daemonConfig["registry-mirrors"] = normalizedMirrors
	data, err := json.MarshalIndent(daemonConfig, "", "  ")
	if err != nil {
		return err
	}

	if _, err = c.vmMgr.Exec(ctx, "sudo", "mkdir", "-p", "/etc/docker"); err != nil {
		return err
	}
	if _, err = c.vmMgr.ExecWithInput(ctx, strings.NewReader(string(data)), "sudo", "tee", "/etc/docker/daemon.json"); err != nil {
		return err
	}
	_, err = c.vmMgr.Exec(ctx, "sudo", "systemctl", "reload", "docker")
	return err
}
