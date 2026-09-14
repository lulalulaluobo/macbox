package api

import (
	"context"
	"net/http"
	"sync"
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
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
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

	var wg sync.WaitGroup
	var mu sync.Mutex

	wg.Add(3)
	go func() {
		defer wg.Done()
		if vmStatus, err := s.vmMgr.GetStatusContext(ctx); err == nil && vmStatus != nil {
			mu.Lock()
			result["vmStatus"] = vmStatus.Status
			result["dockerReady"] = vmStatus.DockerReady
			mu.Unlock()
		} else {
			mu.Lock()
			result["degraded"] = true
			mu.Unlock()
		}
	}()

	go func() {
		defer wg.Done()
		if containers, err := s.dockerClient.ListContainersSummary(ctx); err == nil {
			running := 0
			for _, container := range containers {
				if container.State == "running" {
					running++
				}
			}
			mu.Lock()
			result["dockerTotal"] = len(containers)
			result["dockerRunning"] = running
			mu.Unlock()
		} else {
			mu.Lock()
			result["degraded"] = true
			mu.Unlock()
		}
	}()

	go func() {
		defer wg.Done()
		if cfgSnapshot, err := storageSnapshot(s, ctx); err == nil && cfgSnapshot != nil {
			mu.Lock()
			result["storageName"] = cfgSnapshot.Name
			result["storageUsed"] = cfgSnapshot.UsedSpace
			result["storageTotal"] = cfgSnapshot.TotalSize
			result["storageUsedPercent"] = cfgSnapshot.UsedPercent
			mu.Unlock()
		} else {
			mu.Lock()
			result["degraded"] = true
			mu.Unlock()
		}
	}()

	wg.Wait()

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
