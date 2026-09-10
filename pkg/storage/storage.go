package storage

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/luluen/mac-nas/pkg/config"
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
	IsVirtual        bool   `json:"isVirtual"`
	IsSelected       bool   `json:"isSelected"`
	IsSecondary      bool   `json:"isSecondary"`
	SecondaryTarget  string `json:"secondaryTarget,omitempty"`
}

type ManagedDisk struct {
	Name             string `json:"name"`
	Size             uint64 `json:"size"`
	ActualSize       uint64 `json:"actualSize"`
	ActualSizeString string `json:"actualSizeString"`
	Format           string `json:"format"`
	Dir              string `json:"dir"`
	InUse            bool   `json:"inUse"`
	Instance         string `json:"instance,omitempty"`
}

type StorageOverview struct {
	SelectedDisk     *DiskInfo     `json:"selectedDisk,omitempty"`
	SecondaryDisk    *DiskInfo     `json:"secondaryDisk,omitempty"`
	Disks            []DiskInfo    `json:"disks"`
	ManagedDisks     []ManagedDisk `json:"managedDisks"`
	NASDataDir       string        `json:"nasDataDir"`
	IsExternalActive bool          `json:"isExternalActive"`
	DataPath         string        `json:"dataPath"`
	MountPoint       string        `json:"mountPoint"`
	TotalBytes       uint64        `json:"totalBytes"`
	UsedBytes        uint64        `json:"usedBytes"`
	FreeBytes        uint64        `json:"freeBytes"`
	UsedPercent      float64       `json:"usedPercent"`
}

var (
	disksCacheMu   sync.Mutex
	cachedDisks    []DiskInfo
	cachedDisksAt  time.Time
	cachedSelected string
)

// InvalidateDisksCache forces the next ListDisks call to re-query diskutil
func InvalidateDisksCache() {
	disksCacheMu.Lock()
	defer disksCacheMu.Unlock()
	cachedDisks = nil
}

// ListDisks scans all physical disks and accurately maps APFS containers and volumes (cached 5s)
func ListDisks(selectedDiskIdentifier string, secondaryDiskIdentifier ...string) ([]DiskInfo, error) {
	secondary := ""
	if len(secondaryDiskIdentifier) > 0 {
		secondary = secondaryDiskIdentifier[0]
	}

	disksCacheMu.Lock()
	cacheKey := selectedDiskIdentifier + "|" + secondary
	if cachedDisks != nil && cachedSelected == cacheKey && time.Since(cachedDisksAt) < 5*time.Second {
		res := make([]DiskInfo, len(cachedDisks))
		copy(res, cachedDisks)
		disksCacheMu.Unlock()
		return res, nil
	}
	disksCacheMu.Unlock()

	disks, err := listDisksAPFS(selectedDiskIdentifier, secondary)
	if err != nil || len(disks) == 0 {
		disks, err = listDisksFallback(selectedDiskIdentifier, secondary)
	}
	if err == nil && len(disks) > 0 {
		disksCacheMu.Lock()
		cachedDisks = make([]DiskInfo, len(disks))
		copy(cachedDisks, disks)
		cachedDisksAt = time.Now()
		cachedSelected = cacheKey
		disksCacheMu.Unlock()
	}
	return disks, err
}

type diskutilListOutput struct {
	AllDisksAndPartitions []diskPartitionEntry `json:"AllDisksAndPartitions"`
}

type diskPartitionEntry struct {
	DeviceIdentifier   string              `json:"DeviceIdentifier"`
	Content            string              `json:"Content"`
	Size               uint64              `json:"Size"`
	Partitions         []diskSubPartition  `json:"Partitions"`
	APFSPhysicalStores []apfsPhysicalStore `json:"APFSPhysicalStores"`
	APFSVolumes        []apfsVolumeEntry   `json:"APFSVolumes"`
}

type diskSubPartition struct {
	DeviceIdentifier string `json:"DeviceIdentifier"`
	Content          string `json:"Content"`
	Size             uint64 `json:"Size"`
}

type apfsPhysicalStore struct {
	DeviceIdentifier string `json:"DeviceIdentifier"`
}

type apfsVolumeEntry struct {
	DeviceIdentifier string `json:"DeviceIdentifier"`
	VolumeName       string `json:"VolumeName"`
	MountPoint       string `json:"MountPoint"`
	CapacityInUse    uint64 `json:"CapacityInUse"`
	Size             uint64 `json:"Size"`
	OSInternal       bool   `json:"OSInternal"`
}

type diskutilInfoOutput struct {
	DeviceIdentifier  string `json:"DeviceIdentifier"`
	MediaName         string `json:"MediaName"`
	SolidState        bool   `json:"SolidState"`
	Internal          bool   `json:"Internal"`
	VirtualOrPhysical string `json:"VirtualOrPhysical"`
	WholeDisk         bool   `json:"WholeDisk"`
	TotalSize         uint64 `json:"TotalSize"`
	MountPoint        string `json:"MountPoint"`
	VolumeName        string `json:"VolumeName"`
	FilesystemName    string `json:"FilesystemName"`
}

func listDisksAPFS(selectedDiskIdentifier, secondary string) ([]DiskInfo, error) {
	cmdStr := "diskutil list -plist | plutil -convert json -r -o - -- -"
	cmd := exec.Command("sh", "-c", cmdStr)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var listData diskutilListOutput
	if err := json.Unmarshal(output, &listData); err != nil {
		return nil, err
	}

	// Map partition identifier to APFS volumes
	partToVolumes := make(map[string][]apfsVolumeEntry)
	for _, p := range listData.AllDisksAndPartitions {
		if len(p.APFSPhysicalStores) > 0 && len(p.APFSVolumes) > 0 {
			for _, store := range p.APFSPhysicalStores {
				partToVolumes[store.DeviceIdentifier] = p.APFSVolumes
			}
		}
	}

	var results []DiskInfo
	for _, entry := range listData.AllDisksAndPartitions {
		if !strings.HasPrefix(entry.DeviceIdentifier, "disk") {
			continue
		}
		// Filter out synthetic disks and virtual images
		inf, err := inspectDisk(entry.DeviceIdentifier)
		if err != nil || inf.TotalSize == 0 || !inf.IsWholeDisk {
			continue
		}
		if inf.IsVirtual {
			continue
		}

		disk := *inf

		// Find volumes belonging to this disk
		var vols []apfsVolumeEntry
		for _, part := range entry.Partitions {
			if v, ok := partToVolumes[part.DeviceIdentifier]; ok {
				vols = append(vols, v...)
			}
		}
		if len(entry.APFSVolumes) > 0 {
			vols = append(vols, entry.APFSVolumes...)
		}

		if len(vols) > 0 {
			var mainVol *apfsVolumeEntry
			for i := range vols {
				v := &vols[i]
				if v.MountPoint == "/" || v.MountPoint == "/System/Volumes/Data" {
					mainVol = v
					break
				}
				if mainVol == nil && v.MountPoint != "" {
					mainVol = v
				}
			}
			if mainVol == nil {
				mainVol = &vols[0]
			}

			disk.MountPoint = mainVol.MountPoint
			disk.Mounted = (mainVol.MountPoint != "")
			disk.VolumeName = mainVol.VolumeName
			disk.UsedSpace = mainVol.CapacityInUse
			disk.UsedSpaceString = formatBytes(mainVol.CapacityInUse)
			if disk.TotalSize >= mainVol.CapacityInUse {
				disk.FreeSpace = disk.TotalSize - mainVol.CapacityInUse
				disk.FreeSpaceString = formatBytes(disk.FreeSpace)
				disk.UsedPercent = float64(mainVol.CapacityInUse) / float64(disk.TotalSize) * 100
			}
		}

		if selectedDiskIdentifier != "" && (disk.DeviceIdentifier == selectedDiskIdentifier || disk.DeviceNode == selectedDiskIdentifier) {
			disk.IsSelected = true
		}
		if secondary != "" && (disk.DeviceIdentifier == secondary || disk.DeviceNode == secondary) {
			disk.IsSecondary = true
			disk.SecondaryTarget = "/data/volume2-ssd"
		}

		results = append(results, disk)
	}

	return results, nil
}

func listDisksFallback(selectedDiskIdentifier, secondary string) ([]DiskInfo, error) {
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
		if err != nil || info.TotalSize == 0 {
			continue
		}
		if selectedDiskIdentifier != "" && (info.DeviceIdentifier == selectedDiskIdentifier || info.DeviceNode == selectedDiskIdentifier) {
			info.IsSelected = true
		}
		if secondary != "" && (info.DeviceIdentifier == secondary || info.DeviceNode == secondary) {
			info.IsSecondary = true
			info.SecondaryTarget = "/data/volume2-ssd"
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
		case "Virtual":
			info.IsVirtual = (val == "Yes")
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
			if d.Dir != "" {
				diskFile := filepath.Join(d.Dir, "datadisk")
				if realPath, err := filepath.EvalSymlinks(diskFile); err == nil {
					diskFile = realPath
				}
				if fi, err := os.Stat(diskFile); err == nil {
					if sys, ok := fi.Sys().(*syscall.Stat_t); ok {
						actualBytes := uint64(sys.Blocks) * 512
						d.ActualSize = actualBytes
						d.ActualSizeString = formatBytes(actualBytes)
					}
				}
			}
			if d.ActualSizeString == "" {
				d.ActualSizeString = formatBytes(d.ActualSize)
			}
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

// BindExternalDisk initializes an ext4 disk image on an external filesystem and bridges it to Lima's macnas-data
func BindExternalDisk(cfg *config.Config, diskID, mountPoint string, sizeGB int) (string, error) {
	if mountPoint == "" {
		// Try to look up mount point from diskID
		info, err := inspectDisk(diskID)
		if err == nil && info.MountPoint != "" {
			mountPoint = info.MountPoint
		} else {
			return "", fmt.Errorf("磁盘 %s 未挂载，请先在系统中挂载或指定挂载卷目录", diskID)
		}
	}

	if info, err := os.Stat(mountPoint); err != nil || !info.IsDir() {
		return "", fmt.Errorf("挂载路径不存在或非目录: %s", mountPoint)
	}

	if sizeGB <= 0 {
		sizeGB = 100 // Default to 100 GiB sparse image
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	macnasDir := filepath.Join(mountPoint, "MacNAS")
	// If mount point is root or system data drive, place inside user home on that drive
	if mountPoint == "/System/Volumes/Data" || mountPoint == "/" || strings.HasPrefix(home, mountPoint) {
		macnasDir = filepath.Join(home, "MacNAS")
	} else {
		if err := os.MkdirAll(macnasDir, 0755); err != nil {
			macnasDir = filepath.Join(home, "MacNAS")
		}
	}
	if err := os.MkdirAll(macnasDir, 0755); err != nil {
		return "", fmt.Errorf("无法在外接盘创建 MacNAS 目录: %w", err)
	}

	imgFile := filepath.Join(macnasDir, "datadisk.img")
	if _, err := os.Stat(imgFile); os.IsNotExist(err) {
		// Create sparse image file with mkfile
		cmd := exec.Command("mkfile", "-n", fmt.Sprintf("%dg", sizeGB), imgFile)
		if output, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("创建稀疏镜像失败: %s (%w)", string(output), err)
		}
	}

	// Link into Lima disk directory: ~/.lima/_disks/macnas-data/datadisk
	limaDiskDir := filepath.Join(home, ".lima", "_disks", "macnas-data")
	if err := os.MkdirAll(limaDiskDir, 0700); err != nil {
		return "", fmt.Errorf("无法创建 Lima 磁盘目录: %w", err)
	}

	targetDatadisk := filepath.Join(limaDiskDir, "datadisk")
	// If it exists, check if it's already a symlink or file
	if fi, err := os.Lstat(targetDatadisk); err == nil {
		if fi.Mode()&os.ModeSymlink != 0 {
			_ = os.Remove(targetDatadisk)
		} else {
			// Backup original internal datadisk
			backupPath := filepath.Join(limaDiskDir, "datadisk.internal.bak")
			if _, err := os.Stat(backupPath); os.IsNotExist(err) {
				_ = os.Rename(targetDatadisk, backupPath)
			} else {
				_ = os.Remove(targetDatadisk)
			}
		}
	}

	if err := os.Symlink(imgFile, targetDatadisk); err != nil {
		return "", fmt.Errorf("软链接外接镜像到 Lima 失败: %w", err)
	}

	cfg.Storage.SelectedDisk = diskID
	cfg.Storage.MountPoint = mountPoint
	cfg.Storage.DataPath = imgFile
	_ = config.SaveConfig(cfg)
	InvalidateDisksCache()

	return imgFile, nil
}

// UnbindExternalDisk restores internal disk and cleans symlink
func UnbindExternalDisk(cfg *config.Config) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	limaDiskDir := filepath.Join(home, ".lima", "_disks", "macnas-data")
	targetDatadisk := filepath.Join(limaDiskDir, "datadisk")

	if fi, err := os.Lstat(targetDatadisk); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		_ = os.Remove(targetDatadisk)
		backupPath := filepath.Join(limaDiskDir, "datadisk.internal.bak")
		if _, err := os.Stat(backupPath); err == nil {
			_ = os.Rename(backupPath, targetDatadisk)
		}
	}

	cfg.Storage.SelectedDisk = ""
	cfg.Storage.MountPoint = ""
	cfg.Storage.DataPath = ""
	InvalidateDisksCache()
	return config.SaveConfig(cfg)
}

// BindSecondaryDisk configures a secondary physical disk as high-speed Volume 2
func BindSecondaryDisk(cfg *config.Config, diskID, mountPoint, targetDir, guestTarget, projectRoot, instanceName string) (map[string]interface{}, error) {
	if targetDir == "" {
		if fi, err := os.Stat("/Volumes/Data/Users/Shared"); err == nil && fi.IsDir() {
			targetDir = "/Volumes/Data/Users/Shared/MacNAS-SSD-Pool"
		} else if mountPoint != "" {
			targetDir = filepath.Join(mountPoint, "MacNAS-SSD-Pool")
		} else {
			home, _ := os.UserHomeDir()
			targetDir = filepath.Join(home, "MacNAS-SSD-Pool")
		}
	}

	if err := os.MkdirAll(targetDir, 0777); err != nil {
		return nil, fmt.Errorf("创建存储空间 2 目录失败: %w", err)
	}

	if guestTarget == "" {
		guestTarget = "volume2-ssd"
	}

	mount := config.LocalMount{
		ID:          "volume2-ssd",
		Name:        "存储空间 2 (256GB 本机高速盘)",
		HostPath:    targetDir,
		GuestTarget: guestTarget,
		Writable:    true,
		Enabled:     true,
		Category:    "volume2",
		Description: "Mac 本机 256GB 高速 NVMe 固态硬盘扩展存储池，支持原生 3~5 GB/s 零拷贝极速读写",
	}

	if err := AddOrUpdateLocalMount(cfg, mount); err != nil {
		return nil, err
	}

	cfg.Storage.SecondaryDisk = diskID
	cfg.Storage.SecondaryMount = targetDir
	_ = config.SaveConfig(cfg)
	InvalidateDisksCache()

	if instanceName == "" {
		instanceName = "macnas"
	}
	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "mkdir", "-p", "/data/"+guestTarget)
	_ = cmd.Run()

	return map[string]interface{}{
		"status":          "success",
		"message":         "已成功将 256GB 高速固态盘挂载为存储空间 2！请平稳重启虚拟机以激活 VirtioFS 设备",
		"requiresRestart": true,
		"targetDir":       targetDir,
		"guestTarget":     guestTarget,
	}, nil
}

// UnbindSecondaryDisk removes the secondary disk volume
func UnbindSecondaryDisk(cfg *config.Config, projectRoot, instanceName string) error {
	_ = DeleteLocalMount(cfg, "volume2-ssd")
	cfg.Storage.SecondaryDisk = ""
	cfg.Storage.SecondaryMount = ""
	InvalidateDisksCache()
	return config.SaveConfig(cfg)
}
