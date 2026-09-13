package api

import (
	"context"
	"net/http"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/storage"
	"github.com/lulalulaluobo/macbox/pkg/system"
	"github.com/lulalulaluobo/macbox/pkg/vm"
)

// handleSystemMenubarStatus exposes the small read-only status payload needed
// by the native menu-bar helper. The route is only reachable without a login
// through the loopback-only exception in Handler; it deliberately omits host
// names, IP addresses, paths, and other control-plane details.
func (s *Server) handleSystemMenubarStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	result := map[string]interface{}{
		"timestamp":     time.Now().UTC(),
		"webRunning":    true,
		"vmStatus":      "unknown",
		"dockerReady":   false,
		"dockerTotal":   0,
		"dockerRunning": 0,
	}

	if stats, err := system.GetSystemStats(); err == nil && stats != nil {
		result["cpuPercent"] = stats.CPUPercent
		result["memUsed"] = stats.MemUsed
		result["memTotal"] = stats.MemTotal
		result["memPercent"] = stats.MemPercent
	} else {
		result["degraded"] = true
	}

	_, limaInstalled := vm.FindLima()
	result["limaInstalled"] = limaInstalled

	if vmStatus, err := s.vmMgr.GetStatusContext(ctx); err == nil && vmStatus != nil {
		result["vmStatus"] = vmStatus.Status
		result["dockerReady"] = vmStatus.DockerReady
	} else {
		result["degraded"] = true
	}

	if containers, err := s.dockerClient.ListContainers(ctx); err == nil {
		running := 0
		for _, container := range containers {
			if container.State == "running" {
				running++
			}
		}
		result["dockerTotal"] = len(containers)
		result["dockerRunning"] = running
	} else {
		result["degraded"] = true
	}

	if cfgSnapshot, err := storageSnapshot(s, ctx); err == nil && cfgSnapshot != nil {
		result["storageName"] = cfgSnapshot.Name
		result["storageUsed"] = cfgSnapshot.UsedSpace
		result["storageTotal"] = cfgSnapshot.TotalSize
		result["storageUsedPercent"] = cfgSnapshot.UsedPercent
	} else {
		result["degraded"] = true
	}

	writeJSON(w, http.StatusOK, result)
}

func storageSnapshot(s *Server, ctx context.Context) (*storage.DiskInfo, error) {
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		return nil, err
	}
	disks, err := storage.ListDisksContext(ctx, cfgSnapshot.Storage.SelectedDisk, cfgSnapshot.Storage.SecondaryDisk)
	if err != nil {
		return nil, err
	}
	for index := range disks {
		if disks[index].IsSelected {
			return &disks[index], nil
		}
	}
	if len(disks) > 0 {
		return &disks[0], nil
	}
	return nil, nil
}
