package docker

import (
	"context"
	"strconv"
	"strings"
	"time"
)

type networkSample struct {
	rxBytes float64
	txBytes float64
	at      time.Time
}

func (c *Client) GetOverview(ctx context.Context) (*DockerOverview, error) {
	vmStatus, vmStatusErr := c.vmMgr.GetStatusContext(ctx)
	dockerReady := vmStatusErr == nil && vmStatus != nil && vmStatus.DockerReady

	containers, err := c.ListContainers(ctx)
	if err != nil {
		return &DockerOverview{
			Healthy:         false,
			HealthMessage:   "Docker 服务未响应或正在启动中",
			DockerReady:     false,
			DockerVersion:   "-",
			StorageLocation: "/data/docker",
		}, nil
	}

	images, imagesErr := c.ListImages(ctx)
	if imagesErr != nil {
		images = nil
	}
	projects, projectsErr := c.ListComposeProjectsWithContainers(ctx, containers)
	if projectsErr != nil {
		projects = nil
	}

	runningContainers := 0
	stoppedContainers := 0
	var totalCPU float64 = 0
	var totalMemMB float64 = 0
	var memMaxMB float64 = 0

	for _, ct := range containers {
		if ct.State == "running" {
			runningContainers++
		} else {
			stoppedContainers++
		}

		// Parse CPU
		cpuStr := strings.TrimSuffix(ct.CPUPerc, "%")
		if cpuVal, err := strconv.ParseFloat(cpuStr, 64); err == nil {
			totalCPU += cpuVal
		}

		// Parse Mem: e.g. "101.8MiB / 1.904GiB"
		if strings.Contains(ct.MemUsage, "/") {
			parts := strings.Split(ct.MemUsage, "/")
			if len(parts) == 2 {
				used := strings.TrimSpace(parts[0])
				max := strings.TrimSpace(parts[1])

				usedMB := parseSizeToMB(used)
				totalMemMB += usedMB

				if memMaxMB == 0 {
					memMaxMB = parseSizeToMB(max)
				}
			}
		}

	}

	// Docker stats reports cumulative network counters, not a rate. Convert
	// those counters into bytes per second before returning the overview so the
	// UI does not mistake lifetime traffic for current throughput.
	totalNetRxKB, totalNetTxKB := c.networkRates(containers, time.Now())

	imagesInUse := 0
	for _, img := range images {
		if img.InUse {
			imagesInUse++
		}
	}

	runningProjects := 0
	for _, proj := range projects {
		if proj.Status == "running" {
			runningProjects++
		}
	}

	healthy := true
	healthMsg := "所有服务运行状态健康"
	if imagesErr != nil || projectsErr != nil {
		healthy = false
		healthMsg = "Docker 部分状态暂时不可用"
	}
	if len(containers) == 0 {
		if imagesErr == nil && projectsErr == nil {
			healthMsg = "Docker 引擎运行正常，暂无容器运行"
		}
	} else if stoppedContainers > 0 && runningContainers == 0 {
		healthy = false
		healthMsg = "所有容器目前处于停止状态"
	} else if stoppedContainers > 0 {
		healthMsg = "部分容器已停止运行"
	}

	memPerc := 0.0
	if memMaxMB > 0 {
		memPerc = (totalMemMB / memMaxMB) * 100
	}

	// Read docker version
	verOut, _ := c.runDockerCmd(ctx, "version", "--format", "{{.Server.Version}}")
	dockerVer := strings.TrimSpace(string(verOut))
	if dockerVer == "" {
		dockerVer = "-"
	}

	return &DockerOverview{
		Healthy:           healthy,
		HealthMessage:     healthMsg,
		DockerReady:       dockerReady,
		DockerVersion:     dockerVer,
		StorageLocation:   "存储空间 1 (MacBox 虚拟专有卷)",
		AutoStart:         true,
		ContainersTotal:   len(containers),
		ContainersRunning: runningContainers,
		ContainersStopped: stoppedContainers,
		ImagesTotal:       len(images),
		ImagesInUse:       imagesInUse,
		ProjectsTotal:     len(projects),
		ProjectsRunning:   runningProjects,
		CPUPerc:           totalCPU,
		MemUsageMB:        totalMemMB,
		MemTotalMB:        memMaxMB,
		MemPerc:           memPerc,
		NetRxKB:           totalNetRxKB,
		NetTxKB:           totalNetTxKB,
	}, nil
}

func parseSizeToMB(s string) float64 {
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)
	if strings.HasSuffix(lower, "gib") || strings.HasSuffix(lower, "gb") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(lower, "gib"), "gb")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val * 1024
	}
	if strings.HasSuffix(lower, "mib") || strings.HasSuffix(lower, "mb") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(lower, "mib"), "mb")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val
	}
	if strings.HasSuffix(lower, "kib") || strings.HasSuffix(lower, "kb") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(lower, "kib"), "kb")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val / 1024
	}
	if strings.HasSuffix(lower, "b") {
		numStr := strings.TrimSuffix(lower, "b")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val / (1024 * 1024)
	}
	return 0
}

func parseSizeToKB(s string) float64 {
	return parseSizeToBytes(s) / 1024
}

func parseSizeToBytes(s string) float64 {
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)
	if strings.HasSuffix(lower, "tb") || strings.HasSuffix(lower, "tib") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(lower, "tib"), "tb")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val * 1024 * 1024 * 1024 * 1024
	}
	if strings.HasSuffix(lower, "gb") || strings.HasSuffix(lower, "gib") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(lower, "gib"), "gb")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val * 1024 * 1024 * 1024
	}
	if strings.HasSuffix(lower, "mb") || strings.HasSuffix(lower, "mib") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(lower, "mib"), "mb")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val * 1024 * 1024
	}
	if strings.HasSuffix(lower, "kb") || strings.HasSuffix(lower, "kib") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(lower, "kib"), "kb")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val * 1024
	}
	if strings.HasSuffix(lower, "b") {
		numStr := strings.TrimSuffix(lower, "b")
		val, _ := strconv.ParseFloat(numStr, 64)
		return val
	}
	return 0
}

func (c *Client) networkRates(containers []ContainerInfo, now time.Time) (float64, float64) {
	current := make(map[string]networkSample)
	for _, ct := range containers {
		if strings.TrimSpace(ct.ID) == "" || !strings.Contains(ct.NetIO, "/") {
			continue
		}
		parts := strings.SplitN(ct.NetIO, "/", 2)
		rxBytes := parseSizeToBytes(strings.TrimSpace(parts[0]))
		txBytes := parseSizeToBytes(strings.TrimSpace(parts[1]))
		if rxBytes == 0 && txBytes == 0 && strings.TrimSpace(ct.NetIO) != "0B / 0B" {
			continue
		}
		current[ct.ID] = networkSample{rxBytes: rxBytes, txBytes: txBytes, at: now}
	}

	c.networkRateMu.Lock()
	defer c.networkRateMu.Unlock()
	previous := c.networkSamples
	c.networkSamples = current

	var rxBytesPerSecond, txBytesPerSecond float64
	for id, sample := range current {
		old, ok := previous[id]
		if !ok {
			continue
		}
		seconds := sample.at.Sub(old.at).Seconds()
		if seconds <= 0 {
			continue
		}
		if sample.rxBytes >= old.rxBytes {
			rxBytesPerSecond += (sample.rxBytes - old.rxBytes) / seconds
		}
		if sample.txBytes >= old.txBytes {
			txBytesPerSecond += (sample.txBytes - old.txBytes) / seconds
		}
	}

	return rxBytesPerSecond / 1024, txBytesPerSecond / 1024
}
