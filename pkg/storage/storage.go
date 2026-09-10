package storage

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

type DiskInfo struct {
	DeviceIdentifier string `json:"identifier"`      // e.g. "disk4"
	DeviceNode       string `json:"deviceNode"`      // e.g. "/dev/disk4"
	Name             string `json:"name"`            // e.g. "Lexar SSD THOR PRO 2TB"
	VolumeName       string `json:"volumeName"`      // e.g. "MacNAS Data"
	TotalSize        uint64 `json:"totalSize"`       // bytes
	TotalSizeString  string `json:"totalSizeString"` // e.g. "2.0 TB"
	UsedSpace        uint64 `json:"usedSpace"`
	UsedSpaceString  string `json:"usedSpaceString"`
	FreeSpace        uint64 `json:"freeSpace"`
	FreeSpaceString  string `json:"freeSpaceString"`
	UsedPercent      float64 `json:"usedPercent"`
	Mounted          bool   `json:"mounted"`
	MountPoint       string `json:"mountPoint"`
	FileSystem       string `json:"fileSystem"`
	IsExternal       bool   `json:"isExternal"`
	IsSSD            bool   `json:"isSSD"`
	IsWholeDisk      bool   `json:"isWholeDisk"`
	IsSelected       bool   `json:"isSelected"`
}

type ManagedDisk struct {
	Name      string `json:"name"`
	Size      uint64 `json:"size"`
	Format    string `json:"format"`
	Dir       string `json:"dir"`
	InUse     bool   `json:"inUse"`
	Instance  string `json:"instance,omitempty"`
}

type StorageOverview struct {
	SelectedDisk *DiskInfo     `json:"selectedDisk,omitempty"`
	Disks        []DiskInfo    `json:"disks"`
	ManagedDisks []ManagedDisk `json:"managedDisks"`
	NASDataDir   string        `json:"nasDataDir"`
	TotalBytes   uint64        `json:"totalBytes"`
	UsedBytes    uint64        `json:"usedBytes"`
	FreeBytes    uint64        `json:"freeBytes"`
	UsedPercent  float64       `json:"usedPercent"`
}

// ListDisks scans all physical and external disks on macOS
func ListDisks(selectedDiskIdentifier string) ([]DiskInfo, error) {
	cmd := exec.Command("diskutil", "list")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("diskutil list error: %w", err)
	}

	diskMap := make(map[string]bool)
	scanner := bufio.NewScanner(bytes.NewReader(output))
	diskRegex := regexp.MustCompile(`^/dev/(disk\d+)`)

	for scanner.Scan() {
		line := scanner.Text()
		if matches := diskRegex.FindStringSubmatch(line); len(matches) > 1 {
			diskMap[matches[1]] = true
		}
	}

	var results []DiskInfo
	for diskID := range diskMap {
		info, err := inspectDisk(diskID)
		if err != nil {
			continue
		}
		if info.TotalSize == 0 {
			continue
		}
		if selectedDiskIdentifier != "" && (info.DeviceIdentifier == selectedDiskIdentifier || info.DeviceNode == selectedDiskIdentifier) {
			info.IsSelected = true
		}
		results = append(results, *info)
	}

	return results, nil
}

func inspectDisk(diskID string) (*DiskInfo, error) {
	cmd := exec.Command("diskutil", "info", diskID)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	info := &DiskInfo{
		DeviceIdentifier: diskID,
		DeviceNode:       "/dev/" + diskID,
	}

	scanner := bufio.NewScanner(bytes.NewReader(output))
	bytesRegex := regexp.MustCompile(`\((\d+)\s+Bytes\)`)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		parts := strings.SplitN(line, ":", 2)
		if len(parts) < 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])

		switch key {
		case "Device / Media Name":
			if info.Name == "" {
				info.Name = val
			}
		case "Volume Name":
			if val != "Not applicable (no file system)" && val != "" {
				info.VolumeName = val
				if info.Name == "" {
					info.Name = val
				}
			}
		case "Mounted":
			info.Mounted = (val == "Yes")
		case "Mount Point":
			info.MountPoint = val
		case "File System Personality", "Type (Bundle)":
			if info.FileSystem == "" || info.FileSystem == "None" {
				info.FileSystem = val
			}
		case "Device Location":
			info.IsExternal = (val == "External")
		case "Solid State":
			info.IsSSD = (val == "Yes")
		case "Whole":
			info.IsWholeDisk = (val == "Yes")
		case "Disk Size", "Container Total Space", "Total Size":
			if info.TotalSize == 0 {
				info.TotalSizeString = strings.Split(val, "(")[0]
				if m := bytesRegex.FindStringSubmatch(val); len(m) > 1 {
					info.TotalSize, _ = strconv.ParseUint(m[1], 10, 64)
				}
			}
		case "Volume Used Space":
			info.UsedSpaceString = strings.Split(val, "(")[0]
			if m := bytesRegex.FindStringSubmatch(val); len(m) > 1 {
				info.UsedSpace, _ = strconv.ParseUint(m[1], 10, 64)
			}
		case "Container Free Space", "Volume Free Space":
			info.FreeSpaceString = strings.Split(val, "(")[0]
			if m := bytesRegex.FindStringSubmatch(val); len(m) > 1 {
				info.FreeSpace, _ = strconv.ParseUint(m[1], 10, 64)
			}
		}
	}

	if info.Name == "" {
		info.Name = info.DeviceIdentifier
	}

	if info.TotalSize > 0 && info.UsedSpace > 0 {
		info.UsedPercent = float64(info.UsedSpace) / float64(info.TotalSize) * 100
		if info.FreeSpace == 0 && info.TotalSize >= info.UsedSpace {
			info.FreeSpace = info.TotalSize - info.UsedSpace
			info.FreeSpaceString = formatBytes(info.FreeSpace)
		}
	} else if info.TotalSize > 0 && info.FreeSpace > 0 {
		info.UsedSpace = info.TotalSize - info.FreeSpace
		info.UsedPercent = float64(info.UsedSpace) / float64(info.TotalSize) * 100
		info.UsedSpaceString = formatBytes(info.UsedSpace)
	}

	return info, nil
}

func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// ListManagedDisks calls limactl disk list --json
func ListManagedDisks() ([]ManagedDisk, error) {
	cmd := exec.Command("limactl", "disk", "list", "--json")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var disks []ManagedDisk
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		var d ManagedDisk
		if err := json.Unmarshal([]byte(line), &d); err == nil {
			disks = append(disks, d)
		}
	}
	return disks, nil
}

// CreateManagedDisk creates a new managed disk in Lima
func CreateManagedDisk(name, size string) error {
	cmd := exec.Command("limactl", "disk", "create", name, "--size", size)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("limactl disk create failed: %s (%w)", string(output), err)
	}
	return nil
}
