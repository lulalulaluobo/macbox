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
	ID       string `json:"ID"`
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`
	MemUsage string `json:"MemUsage"`
	MemPerc  string `json:"MemPerc"`
	NetIO    string `json:"NetIO"`
	BlockIO  string `json:"BlockIO"`
}

type containerMount struct {
	Type        string `json:"Type"`
	Source      string `json:"Source"`
	Destination string `json:"Destination"`
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
var containerReferenceRegex = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

const (
	defaultLogTail = 100
	maxLogTail     = 10000
)

// NormalizeLogTail keeps log endpoints from materializing an unbounded
// response when a client supplies a very large tail value.
func NormalizeLogTail(tail int) int {
	if tail <= 0 {
		return defaultLogTail
	}
	if tail > maxLogTail {
		return maxLogTail
	}
	return tail
}

func normalizeContainerRef(idOrName string) (string, error) {
	idOrName = strings.TrimSpace(idOrName)
	if !containerReferenceRegex.MatchString(idOrName) {
		return "", fmt.Errorf("容器标识格式无效")
	}
	return idOrName, nil
}

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
	return c.containerStatsCache.get(ctx, containerStatsCacheTTL, func() ([]ContainerInfo, error) {
		return c.listContainersUncached(ctx, true)
	})
}

// ListContainersSummary returns the same container identity/state data without
// starting docker stats. Catalog and Compose screens only need this lighter
// snapshot; live metrics remain opt-in for the container detail/overview
// views.
func (c *Client) ListContainersSummary(ctx context.Context) ([]ContainerInfo, error) {
	return c.containerSummaryCache.get(ctx, containerSummaryCacheTTL, func() ([]ContainerInfo, error) {
		return c.listContainersUncached(ctx, false)
	})
}

func (c *Client) listContainersUncached(ctx context.Context, includeStats bool) ([]ContainerInfo, error) {
	out, err := c.runDockerCmd(ctx, "ps", "-a", "--format", "{{json .}}")
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	statsMap := map[string]containerStatsRaw{}
	if includeStats {
		statsMap = c.getContainerStatsMap(ctx)
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
	var err error
	idOrName, err = normalizeContainerRef(idOrName)
	if err != nil {
		return err
	}
	_, err = c.runDockerCmd(ctx, "start", idOrName)
	return err
}

func (c *Client) StopContainer(ctx context.Context, idOrName string) error {
	var err error
	idOrName, err = normalizeContainerRef(idOrName)
	if err != nil {
		return err
	}
	_, err = c.runDockerCmd(ctx, "stop", idOrName)
	return err
}

func (c *Client) RestartContainer(ctx context.Context, idOrName string) error {
	var err error
	idOrName, err = normalizeContainerRef(idOrName)
	if err != nil {
		return err
	}
	_, err = c.runDockerCmd(ctx, "restart", idOrName)
	return err
}

// RestartContainersUsingDataMount refreshes running containers whose bind
// mount source is /data (or one of its children). Local Mac passthrough paths
// are applied to /data after Docker has started during a VM boot. Linux bind
// mounts are captured when the container starts, so these containers need one
// restart before they can see a newly mounted or changed local directory.
//
// The method deliberately affects only running containers that explicitly
// bind MacBox's data directory; unrelated containers are left untouched.
func (c *Client) RestartContainersUsingDataMount(ctx context.Context) ([]string, error) {
	out, err := c.runDockerCmd(ctx, "ps", "-q")
	if err != nil {
		return nil, fmt.Errorf("读取运行中的 Docker 容器失败: %w", err)
	}

	var restarted []string
	for _, rawID := range strings.Fields(string(out)) {
		id, err := normalizeContainerRef(rawID)
		if err != nil {
			continue
		}

		inspectOut, err := c.runDockerCmd(ctx, "inspect", "--format", "{{json .Mounts}}", id)
		if err != nil {
			return restarted, fmt.Errorf("读取容器 %s 的挂载信息失败: %w", id, err)
		}

		var mounts []containerMount
		if err := json.Unmarshal(bytes.TrimSpace(inspectOut), &mounts); err != nil {
			return restarted, fmt.Errorf("解析容器 %s 的挂载信息失败: %w", id, err)
		}
		if !hasDataBindMount(mounts) {
			continue
		}

		if _, err := c.runDockerCmd(ctx, "restart", id); err != nil {
			return restarted, fmt.Errorf("重启使用 MacBox 数据目录的容器 %s 失败: %w", id, err)
		}
		restarted = append(restarted, id)
	}

	if len(restarted) > 0 {
		c.InvalidateContainerCaches()
	}
	return restarted, nil
}

func hasDataBindMount(mounts []containerMount) bool {
	for _, mount := range mounts {
		if mount.Type != "bind" {
			continue
		}
		source := strings.TrimRight(strings.TrimSpace(mount.Source), "/")
		if source == "/data" || strings.HasPrefix(source, "/data/") {
			return true
		}
	}
	return false
}

func (c *Client) RemoveContainer(ctx context.Context, idOrName string, force bool) error {
	idOrName, err := normalizeContainerRef(idOrName)
	if err != nil {
		return err
	}

	args := []string{"rm"}
	if force {
		args = append(args, "-f")
	}
	args = append(args, idOrName)
	if _, err := c.runDockerCmd(ctx, args...); err != nil {
		return err
	}

	return nil
}

func (c *Client) GetLogs(ctx context.Context, idOrName string, tail int) (string, error) {
	tail = NormalizeLogTail(tail)
	var err error
	idOrName, err = normalizeContainerRef(idOrName)
	if err != nil {
		return "", err
	}
	out, err := c.runDockerCmd(ctx, "logs", fmt.Sprintf("--tail=%d", tail), idOrName)
	return string(out), err
}
