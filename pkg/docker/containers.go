package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type containerStatsRaw struct {
	ID        string `json:"ID"`
	Name      string `json:"Name"`
	CPUPerc   string `json:"CPUPerc"`
	MemUsage  string `json:"MemUsage"`
	MemPerc   string `json:"MemPerc"`
	NetIO     string `json:"NetIO"`
	BlockIO   string `json:"BlockIO"`
}

func (c *Client) getContainerStatsMap(ctx context.Context) map[string]containerStatsRaw {
	statsMap := make(map[string]containerStatsRaw)
	out, err := c.runDockerCmd(ctx, "stats", "--no-stream", "--format", "{{json .}}")
	if err != nil {
		return statsMap
	}

	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var stat containerStatsRaw
		if err := json.Unmarshal([]byte(line), &stat); err == nil {
			statsMap[stat.ID] = stat
			cleanName := strings.TrimPrefix(stat.Name, "/")
			statsMap[cleanName] = stat
		}
	}
	return statsMap
}

var portRegex = regexp.MustCompile(`(?:([0-9\.]+)|\[([0-9a-fA-F:]+)\]):(\d+)->(\d+)(?:/(\w+))?`)

func parsePortMappings(portsStr string) []PortMapping {
	if portsStr == "" {
		return nil
	}
	var list []PortMapping
	seen := make(map[int]bool)

	// parts split by comma
	parts := strings.Split(portsStr, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		matches := portRegex.FindStringSubmatch(part)
		if len(matches) > 4 {
			hostPort, _ := strconv.Atoi(matches[3])
			containerPort, _ := strconv.Atoi(matches[4])
			proto := matches[5]
			if proto == "" {
				proto = "tcp"
			}
			// Deduplicate by hostPort so IPv4/IPv6 dual stack doesn't show duplicate buttons
			if !seen[hostPort] && hostPort > 0 {
				seen[hostPort] = true
				hostIP := matches[1]
				if hostIP == "" {
					hostIP = "0.0.0.0"
				}
				list = append(list, PortMapping{
					HostIP:        hostIP,
					HostPort:      hostPort,
					ContainerPort: containerPort,
					Protocol:      proto,
				})
			}
		}
	}
	return list
}

func (c *Client) ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	out, err := c.runDockerCmd(ctx, "ps", "-a", "--format", "{{json .}}")
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	statsMap := c.getContainerStatsMap(ctx)

	var containers []ContainerInfo
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			id := getString(raw, "ID")
			name := strings.TrimPrefix(getString(raw, "Names"), "/")
			ports := getString(raw, "Ports")

			// Check project label
			labels := getString(raw, "Labels")
			project := ""
			if strings.Contains(labels, "com.docker.compose.project=") {
				for _, label := range strings.Split(labels, ",") {
					if strings.HasPrefix(label, "com.docker.compose.project=") {
						project = strings.TrimPrefix(label, "com.docker.compose.project=")
					}
				}
			}

			// Get live stats if available
			stat, hasStat := statsMap[name]
			if !hasStat {
				stat = statsMap[id]
			}

			cpuPerc := "0.00%"
			memUsage := "-"
			memPerc := "0.00%"
			netIo := "-"
			blockIo := "-"
			if hasStat {
				cpuPerc = stat.CPUPerc
				memUsage = stat.MemUsage
				memPerc = stat.MemPerc
				netIo = stat.NetIO
				blockIo = stat.BlockIO
			}

			item := ContainerInfo{
				ID:        id,
				Names:     name,
				Image:     getString(raw, "Image"),
				State:     strings.ToLower(getString(raw, "State")),
				Status:    getString(raw, "Status"),
				Ports:     ports,
				PortsMap:  parsePortMappings(ports),
				CreatedAt: getString(raw, "CreatedAt"),
				CPUPerc:   cpuPerc,
				MemUsage:  memUsage,
				MemPerc:   memPerc,
				NetIO:     netIo,
				BlockIO:   blockIo,
				Project:   project,
			}
			containers = append(containers, item)
		}
	}

	return containers, nil
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

func (c *Client) RemoveContainer(ctx context.Context, idOrName string, force bool) error {
	args := []string{"rm"}
	if force {
		args = append(args, "-f")
	}
	args = append(args, idOrName)
	_, err := c.runDockerCmd(ctx, args...)
	return err
}

func (c *Client) GetLogs(ctx context.Context, idOrName string, tail int) (string, error) {
	if tail <= 0 {
		tail = 100
	}
	out, err := c.runDockerCmd(ctx, "logs", fmt.Sprintf("--tail=%d", tail), idOrName)
	return string(out), err
}
