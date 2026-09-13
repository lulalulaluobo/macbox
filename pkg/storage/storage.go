package storage

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"github.com/lulalulaluobo/macbox/pkg/config"
)

type DiskInfo struct {
	DeviceIdentifier     string  `json:"identifier"`      // e.g. "disk4"
	DeviceNode           string  `json:"deviceNode"`      // e.g. "/dev/disk4"
	Name                 string  `json:"name"`            // e.g. "Lexar SSD THOR PRO 2TB"
	VolumeName           string  `json:"volumeName"`      // e.g. "MacBox Data"
	TotalSize            uint64  `json:"totalSize"`       // bytes
	TotalSizeString      string  `json:"totalSizeString"` // e.g. "2.0 TB"
	UsedSpace            uint64  `json:"usedSpace"`
	UsedSpaceString      string  `json:"usedSpaceString"`
	FreeSpace            uint64  `json:"freeSpace"`
	FreeSpaceString      string  `json:"freeSpaceString"`
	UsedPercent          float64 `json:"usedPercent"`
	Mounted              bool    `json:"mounted"`
	MountPoint           string  `json:"mountPoint"`
	RecommendedTargetDir string  `json:"recommendedTargetDir,omitempty"`
	FileSystem           string  `json:"fileSystem"`
	IsExternal           bool    `json:"isExternal"`
	IsSSD                bool    `json:"isSSD"`
	IsWholeDisk          bool    `json:"isWholeDisk"`
	IsVirtual            bool    `json:"isVirtual"`
	IsSelected           bool    `json:"isSelected"`
	IsSecondary          bool    `json:"isSecondary"`
	SecondaryTarget      string  `json:"secondaryTarget,omitempty"`
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
	DataDir          string        `json:"dataDir"`
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
	storageMu      sync.Mutex
	diskIDPattern  = regexp.MustCompile(`^(?:/dev/)?disk[0-9]+$`)
)

const maxExternalDiskSizeGB = 16 * 1024

// NormalizeDiskIdentifier restricts disk values to the identifiers accepted by
// diskutil. Returning the short form also keeps config values stable.
func NormalizeDiskIdentifier(identifier string) (string, error) {
	identifier = strings.TrimSpace(identifier)
	if !diskIDPattern.MatchString(identifier) {
		return "", fmt.Errorf("磁盘标识格式无效")
	}
	return strings.TrimPrefix(identifier, "/dev/"), nil
}

func normalizeExistingDirectory(raw, label string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 4096 || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return "", fmt.Errorf("%s路径无效", label)
	}
	absPath, err := filepath.Abs(raw)
	if err != nil {
		return "", fmt.Errorf("解析%s路径失败: %w", label, err)
	}
	absPath = filepath.Clean(absPath)
	info, err := os.Stat(absPath)
	if err != nil {
		return "", fmt.Errorf("%s路径不存在: %s", label, absPath)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s路径不是目录: %s", label, absPath)
	}
	if realPath, err := filepath.EvalSymlinks(absPath); err == nil {
		absPath = realPath
	}
	return absPath, nil
}

// resolveDiskMountPointContext resolves the mount point from the physical
// disk identifier whenever possible. The frontend also sends a mount point,
// but that value can be stale after a disk is remounted or after macOS
// changes the visible APFS volume path. Binding against the authoritative
// disk listing prevents a 256 GB internal volume from accidentally using the
// 2 TB volume's path (and vice versa).
func resolveDiskMountPointContext(ctx context.Context, diskID, requested, label string) (string, error) {
	requested = strings.TrimSpace(requested)
	if diskID != "" {
		if disks, err := ListDisksContext(ctx, diskID); err == nil {
			for _, disk := range disks {
				if disk.DeviceIdentifier != diskID && disk.DeviceNode != "/dev/"+diskID {
					continue
				}
				if strings.TrimSpace(disk.MountPoint) == "" {
					return "", fmt.Errorf("磁盘 %s 当前没有可写挂载卷，请先在 macOS 中挂载该磁盘", diskID)
				}
				requested = disk.MountPoint
				break
			}
		} else if ctx != nil && ctx.Err() != nil {
			return "", ctx.Err()
		}
	}
	if requested == "" && diskID != "" {
		info, err := inspectDiskContext(ctx, diskID)
		if err == nil {
			requested = info.MountPoint
		}
	}
	if requested == "" {
		return "", fmt.Errorf("%s路径不存在，请先在系统中挂载对应磁盘", label)
	}
	return normalizeExistingDirectory(requested, label)
}

func sameResolvedPath(left, right string) bool {
	leftResolved, leftErr := filepath.EvalSymlinks(left)
	rightResolved, rightErr := filepath.EvalSymlinks(right)
	if leftErr != nil || rightErr != nil {
		leftResolved, _ = filepath.Abs(left)
		rightResolved, _ = filepath.Abs(right)
	}
	return filepath.Clean(leftResolved) == filepath.Clean(rightResolved)
}

// sameLinkTargetPath also handles a broken managed symlink. EvalSymlinks is
// intentionally unable to resolve a missing external image, but the link's
// recorded target can still be compared with the configured image path before
// we safely restore the internal backup.
func sameLinkTargetPath(linkPath, configuredPath string) bool {
	if sameResolvedPath(linkPath, configuredPath) {
		return true
	}
	target, err := os.Readlink(linkPath)
	if err != nil {
		return false
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(linkPath), target)
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return false
	}
	configuredPath, err = filepath.Abs(configuredPath)
	if err != nil {
		return false
	}
	return filepath.Clean(target) == filepath.Clean(configuredPath)
}

func pathWithin(base, candidate string) bool {
	rel, err := filepath.Rel(filepath.Clean(base), filepath.Clean(candidate))
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// validateStorageTargetDir constrains the host directory used for the
// secondary storage pool. A request must not be able to make the service
// create/chmod an arbitrary path such as /etc or /Library. Existing symlink
// components are rejected conservatively because MkdirAll/Chmod would follow
// them and could otherwise escape the selected volume between checks.
func validateStorageTargetDir(targetDir, mountPoint, home string, allowHome bool) error {
	targetDir = filepath.Clean(targetDir)
	if targetDir == "." || targetDir == "/" || !filepath.IsAbs(targetDir) {
		return fmt.Errorf("第二存储卷目录无效")
	}
	if mountPoint != "" && mountPoint != "/" && filepath.Clean(targetDir) == filepath.Clean(mountPoint) {
		return fmt.Errorf("第二存储卷目录不能直接使用卷根目录")
	}

	allowedBases := make([]string, 0, 2)
	if mountPoint != "" && mountPoint != "/" {
		allowedBases = append(allowedBases, mountPoint)
	} else {
		allowHome = true
		allowedBases = append(allowedBases, "/Volumes")
	}
	if allowHome && strings.TrimSpace(home) != "" {
		allowedBases = append(allowedBases, home)
	}

	type resolvedBase struct {
		path string
		ok   bool
	}
	bases := make([]resolvedBase, 0, len(allowedBases))
	for _, base := range allowedBases {
		base = filepath.Clean(base)
		resolved, err := filepath.EvalSymlinks(base)
		if err != nil {
			resolved = base
		}
		bases = append(bases, resolvedBase{path: filepath.Clean(resolved), ok: true})
	}

	probe := targetDir
	for {
		info, err := os.Lstat(probe)
		if err == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("第二存储卷目录不能包含符号链接")
			}
			resolved, err := filepath.EvalSymlinks(probe)
			if err != nil {
				return fmt.Errorf("检查第二存储卷目录失败: %w", err)
			}
			resolved = filepath.Clean(resolved)
			for _, base := range bases {
				if base.ok && pathWithin(base.path, resolved) {
					return nil
				}
			}
			return fmt.Errorf("第二存储卷目录必须位于已选择的外部卷或用户目录内")
		}
		if !os.IsNotExist(err) {
			return fmt.Errorf("检查第二存储卷目录失败: %w", err)
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return fmt.Errorf("第二存储卷目录无效")
		}
		probe = parent
	}
}

// InvalidateDisksCache forces the next ListDisks call to re-query diskutil
func InvalidateDisksCache() {
	disksCacheMu.Lock()
	defer disksCacheMu.Unlock()
	cachedDisks = nil
}

// ListDisks scans all physical disks and accurately maps APFS containers and volumes (cached 5s)
func ListDisks(selectedDiskIdentifier string, secondaryDiskIdentifier ...string) ([]DiskInfo, error) {
	return ListDisksContext(context.Background(), selectedDiskIdentifier, secondaryDiskIdentifier...)
}

// ListDisksContext is the request-aware variant used by HTTP handlers. Disk
// discovery can involve several native utilities, so a disconnected client
// must be able to stop the whole scan instead of leaving child processes
// behind.
func ListDisksContext(ctx context.Context, selectedDiskIdentifier string, secondaryDiskIdentifier ...string) ([]DiskInfo, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	secondary := ""
	if len(secondaryDiskIdentifier) > 0 {
		secondary = secondaryDiskIdentifier[0]
	}
	var err error
	if strings.TrimSpace(selectedDiskIdentifier) != "" {
		selectedDiskIdentifier, err = NormalizeDiskIdentifier(selectedDiskIdentifier)
		if err != nil {
			return nil, err
		}
	}
	if strings.TrimSpace(secondary) != "" {
		secondary, err = NormalizeDiskIdentifier(secondary)
		if err != nil {
			return nil, err
		}
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

	disks, err := listDisksAPFS(ctx, selectedDiskIdentifier, secondary)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil || len(disks) == 0 {
		disks, err = listDisksFallback(ctx, selectedDiskIdentifier, secondary)
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

func listDisksAPFS(ctx context.Context, selectedDiskIdentifier, secondary string) ([]DiskInfo, error) {
	diskutilCmd := exec.CommandContext(ctx, "diskutil", "list", "-plist")
	plist, err := diskutilCmd.Output()
	if err != nil {
		return nil, fmt.Errorf("读取磁盘列表失败: %w", err)
	}

	plutilCmd := exec.CommandContext(ctx, "plutil", "-convert", "json", "-r", "-o", "-", "--", "-")
	plutilCmd.Stdin = bytes.NewReader(plist)
	output, err := plutilCmd.Output()
	if err != nil {
		return nil, fmt.Errorf("转换磁盘列表失败: %w", err)
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
		inf, err := inspectDiskContext(ctx, entry.DeviceIdentifier)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			continue
		}
		if inf.TotalSize == 0 || !inf.IsWholeDisk {
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
			if mainVol := selectUsableAPFSVolume(vols); mainVol != nil {
				disk.MountPoint = mainVol.MountPoint
				disk.Mounted = true
				disk.VolumeName = mainVol.VolumeName
				disk.UsedSpace = mainVol.CapacityInUse
				disk.UsedSpaceString = formatBytes(mainVol.CapacityInUse)
				if disk.TotalSize >= mainVol.CapacityInUse {
					disk.FreeSpace = disk.TotalSize - mainVol.CapacityInUse
					disk.FreeSpaceString = formatBytes(disk.FreeSpace)
					disk.UsedPercent = float64(mainVol.CapacityInUse) / float64(disk.TotalSize) * 100
				}
			}
		}

		if selectedDiskIdentifier != "" && (disk.DeviceIdentifier == selectedDiskIdentifier || disk.DeviceNode == selectedDiskIdentifier) {
			disk.IsSelected = true
		}
		if secondary != "" && (disk.DeviceIdentifier == secondary || disk.DeviceNode == secondary) {
			disk.IsSecondary = true
			disk.SecondaryTarget = "/data/volume2-ssd"
		}
		disk.RecommendedTargetDir = recommendedSecondaryTargetDir(disk.MountPoint, disk.IsExternal)

		results = append(results, disk)
	}

	return results, nil
}

// selectUsableAPFSVolume chooses the writable user-data volume for a physical
// disk. APFS containers also expose Preboot, Recovery, VM, Update and Apple
// silicon helper volumes; selecting the first mounted volume made disk0 look
// like /System/Volumes/iSCPreboot and caused storage binding to fail.
func selectUsableAPFSVolume(vols []apfsVolumeEntry) *apfsVolumeEntry {
	best := -1
	bestScore := -1
	for i := range vols {
		volume := &vols[i]
		if !isUsableAPFSVolume(*volume) {
			continue
		}
		score := 50
		if volume.MountPoint == "/System/Volumes/Data" {
			// Prefer the writable Data half of a paired macOS installation
			// over its read-only root snapshot.
			score = 100
		} else if volume.MountPoint == "/" {
			score = 95
		} else if isDataVolumeName(volume.VolumeName) {
			score = 90
		}
		if score > bestScore {
			best = i
			bestScore = score
		}
	}
	if best < 0 {
		return nil
	}
	return &vols[best]
}

func isDataVolumeName(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	return lower == "data" || strings.HasSuffix(lower, " - data")
}

func isUsableAPFSVolume(volume apfsVolumeEntry) bool {
	mount := filepath.Clean(strings.TrimSpace(volume.MountPoint))
	if mount == "." || mount == "" {
		return false
	}
	lowerName := strings.ToLower(strings.TrimSpace(volume.VolumeName))
	lowerMount := strings.ToLower(mount)
	for _, token := range []string{"preboot", "recovery", "vm", "update", "iscpreboot", "xart", "hardware"} {
		if lowerName == token || strings.HasPrefix(lowerName, token+" ") {
			return false
		}
	}
	for _, prefix := range []string{
		"/system/volumes/preboot",
		"/system/volumes/vm",
		"/system/volumes/update",
		"/system/volumes/iscr",
		"/system/volumes/xart",
		"/system/volumes/hardware",
		"/private/tmp/",
	} {
		if strings.HasPrefix(lowerMount, prefix) {
			return false
		}
	}
	// The read-only system half of a paired macOS installation is not a
	// suitable directory target when its writable Data volume is available.
	if lowerMount == "/volumes/macintosh hd" && !isDataVolumeName(volume.VolumeName) {
		return false
	}
	return true
}

func isSystemHelperMountPoint(mountPoint string) bool {
	mount := strings.ToLower(filepath.Clean(strings.TrimSpace(mountPoint)))
	if mount == "/system/volumes/data" {
		return false
	}
	for _, prefix := range []string{
		"/system/volumes/isc",
		"/system/volumes/preboot",
		"/system/volumes/vm",
		"/system/volumes/update",
		"/system/volumes/xart",
		"/system/volumes/hardware",
		"/private/tmp/",
	} {
		if strings.HasPrefix(mount, prefix) {
			return true
		}
	}
	return false
}

// recommendedSecondaryTargetDir returns the host-side directory used to
// store the secondary volume image. The guest mount point is fixed at
// /data/volume2-ssd; users should never need to enter that path here.
func recommendedSecondaryTargetDir(mountPoint string, isExternal bool) string {
	mountPoint = filepath.Clean(strings.TrimSpace(mountPoint))
	if mountPoint == "." || mountPoint == "" || mountPoint == "/" || isSystemHelperMountPoint(mountPoint) {
		return ""
	}

	// Internal macOS data volumes can be reported as either
	// /System/Volumes/Data or /Volumes/Data. /Volumes/Data is root-owned on
	// many systems, so always place the pool below the current user's home for
	// internal disks. This also avoids asking the user to grant unnecessary
	// access to the volume root.
	if !isExternal || mountPoint == "/System/Volumes/Data" {
		if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
			return filepath.Join(home, "MacBox-SSD-Pool")
		}
	}
	return filepath.Join(mountPoint, "MacBox-SSD-Pool")
}

func listDisksFallback(ctx context.Context, selectedDiskIdentifier, secondary string) ([]DiskInfo, error) {
	cmd := exec.CommandContext(ctx, "diskutil", "list")
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
		info, err := inspectDiskContext(ctx, diskID)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			continue
		}
		if info.TotalSize == 0 {
			continue
		}
		if selectedDiskIdentifier != "" && (info.DeviceIdentifier == selectedDiskIdentifier || info.DeviceNode == selectedDiskIdentifier) {
			info.IsSelected = true
		}
		if secondary != "" && (info.DeviceIdentifier == secondary || info.DeviceNode == secondary) {
			info.IsSecondary = true
			info.SecondaryTarget = "/data/volume2-ssd"
		}
		info.RecommendedTargetDir = recommendedSecondaryTargetDir(info.MountPoint, info.IsExternal)
		results = append(results, *info)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取磁盘列表失败: %w", err)
	}
	return results, nil
}

func inspectDisk(diskID string) (*DiskInfo, error) {
	return inspectDiskContext(context.Background(), diskID)
}

func inspectDiskContext(ctx context.Context, diskID string) (*DiskInfo, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	cmd := exec.CommandContext(ctx, "diskutil", "info", diskID)
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
	return ListManagedDisksContext(context.Background())
}

// ListManagedDisksContext lets callers cancel Lima disk discovery when the
// request or VM lifecycle operation is no longer interested in the result.
func ListManagedDisksContext(ctx context.Context) ([]ManagedDisk, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	cmd := exec.CommandContext(ctx, "limactl", "disk", "list", "--json")
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
		if err := json.Unmarshal([]byte(line), &d); err != nil {
			return nil, fmt.Errorf("解析 Lima 磁盘列表失败: %w", err)
		}
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
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取 Lima 磁盘列表失败: %w", err)
	}
	return disks, nil
}

// CreateManagedDisk creates a new managed disk in Lima
func CreateManagedDisk(name, size string) error {
	return CreateManagedDiskContext(context.Background(), name, size)
}

func CreateManagedDiskContext(ctx context.Context, name, size string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	cmd := exec.CommandContext(ctx, "limactl", "disk", "create", name, "--size", size)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("limactl disk create failed: %s (%w)", string(output), err)
	}
	return nil
}

// BindExternalDisk initializes an ext4 disk image on an external filesystem and bridges it to Lima's macbox-data
func BindExternalDisk(cfg *config.Config, diskID, mountPoint string, sizeGB int) (string, error) {
	return BindExternalDiskContext(context.Background(), cfg, diskID, mountPoint, sizeGB)
}

// BindExternalDiskContext is the request-aware variant used by HTTP handlers.
// Native disk probing and sparse image creation must stop when the caller
// disconnects instead of continuing a potentially large host-side operation.
func BindExternalDiskContext(ctx context.Context, cfg *config.Config, diskID, mountPoint string, sizeGB int) (string, error) {
	if cfg == nil {
		return "", fmt.Errorf("配置不能为空")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	storageMu.Lock()
	defer storageMu.Unlock()
	cfgSnapshot, err := config.Snapshot(cfg)
	if err != nil {
		return "", fmt.Errorf("读取存储配置失败: %w", err)
	}

	if strings.TrimSpace(diskID) != "" {
		normalized, err := NormalizeDiskIdentifier(diskID)
		if err != nil {
			return "", err
		}
		diskID = normalized
	}
	if diskID == "" && mountPoint == "" {
		return "", fmt.Errorf("必须提供磁盘标识或挂载路径")
	}
	normalizedMountPoint, err := resolveDiskMountPointContext(ctx, diskID, mountPoint, "挂载")
	if err != nil {
		return "", err
	}
	if isSystemHelperMountPoint(normalizedMountPoint) {
		return "", fmt.Errorf("选中的挂载点是 macOS 系统辅助卷（%s），请选择可写的数据卷，例如 /Volumes/数据卷名", normalizedMountPoint)
	}
	mountPoint = normalizedMountPoint

	if sizeGB == 0 {
		sizeGB = 10 // Default to a small sparse image; host passthrough data stays on macOS
	}
	if sizeGB < 1 || sizeGB > maxExternalDiskSizeGB {
		return "", fmt.Errorf("外接数据盘容量必须在 1 到 %d GiB 之间", maxExternalDiskSizeGB)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	macboxDir := filepath.Join(mountPoint, "MacBox")
	// If mount point is root or system data drive, place inside user home on that drive
	if mountPoint == "/System/Volumes/Data" || mountPoint == "/" {
		macboxDir = filepath.Join(home, "MacBox")
	}
	if err := os.MkdirAll(macboxDir, 0700); err != nil {
		return "", fmt.Errorf("无法在外接盘创建 MacBox 目录: %w", err)
	}
	if err := os.Chmod(macboxDir, 0700); err != nil {
		return "", fmt.Errorf("无法保护外接盘 MacBox 目录: %w", err)
	}

	imgFile := filepath.Join(macboxDir, "datadisk.img")
	createdImage := false
	cleanupCreatedImage := func(cause error) (string, error) {
		if !createdImage {
			return "", cause
		}
		if removeErr := os.Remove(imgFile); removeErr != nil && !os.IsNotExist(removeErr) {
			return "", fmt.Errorf("%v；清理新建镜像失败: %w", cause, removeErr)
		}
		return "", cause
	}
	if info, err := os.Stat(imgFile); err == nil {
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("数据盘镜像路径不是普通文件: %s", imgFile)
		}
	} else if os.IsNotExist(err) {
		// Create sparse image file with mkfile
		cmd := exec.CommandContext(ctx, "mkfile", "-n", fmt.Sprintf("%dg", sizeGB), imgFile)
		if output, err := cmd.CombinedOutput(); err != nil {
			cause := fmt.Errorf("创建稀疏镜像失败: %s (%w)", string(output), err)
			if removeErr := os.Remove(imgFile); removeErr != nil && !os.IsNotExist(removeErr) {
				return "", fmt.Errorf("%v；清理部分镜像失败: %w", cause, removeErr)
			}
			return "", cause
		}
		createdImage = true
	} else {
		return "", fmt.Errorf("检查数据盘镜像失败: %w", err)
	}

	dataDiskName, err := config.NormalizeDataDiskName(cfgSnapshot.VM.DataDiskName)
	if err != nil {
		return cleanupCreatedImage(err)
	}

	// Link into Lima disk directory: ~/.lima/_disks/<data-disk>/datadisk
	limaDiskDir := filepath.Join(home, ".lima", "_disks", dataDiskName)
	if err := os.MkdirAll(limaDiskDir, 0700); err != nil {
		return cleanupCreatedImage(fmt.Errorf("无法创建 Lima 磁盘目录: %w", err))
	}
	if err := os.Chmod(limaDiskDir, 0700); err != nil {
		return cleanupCreatedImage(fmt.Errorf("无法保护 Lima 磁盘目录: %w", err))
	}

	targetDatadisk := filepath.Join(limaDiskDir, "datadisk")
	backupPath := filepath.Join(limaDiskDir, "datadisk.internal.bak")
	managedLink := false
	movedInternal := false
	if fi, err := os.Lstat(targetDatadisk); err == nil {
		if fi.Mode()&os.ModeSymlink != 0 {
			if !sameResolvedPath(targetDatadisk, imgFile) {
				return cleanupCreatedImage(fmt.Errorf("Lima 数据盘链接已指向其他位置，请先人工确认: %s", targetDatadisk))
			}
			managedLink = true
		} else {
			if fi.IsDir() || !fi.Mode().IsRegular() {
				return cleanupCreatedImage(fmt.Errorf("Lima 数据盘目标不是可安全备份的普通文件: %s", targetDatadisk))
			}
			if _, backupErr := os.Lstat(backupPath); backupErr == nil {
				return cleanupCreatedImage(fmt.Errorf("检测到已有内部数据盘备份，请先人工处理: %s", backupPath))
			} else if !os.IsNotExist(backupErr) {
				return cleanupCreatedImage(fmt.Errorf("检查内部数据盘备份失败: %w", backupErr))
			}
			if err := os.Rename(targetDatadisk, backupPath); err != nil {
				return cleanupCreatedImage(fmt.Errorf("备份内部数据盘失败: %w", err))
			}
			movedInternal = true
		}
	} else if !os.IsNotExist(err) {
		return cleanupCreatedImage(fmt.Errorf("检查 Lima 数据盘目标失败: %w", err))
	}

	if !managedLink {
		if err := os.Symlink(imgFile, targetDatadisk); err != nil {
			var rollbackErr error
			if movedInternal {
				rollbackErr = os.Rename(backupPath, targetDatadisk)
			}
			cause := fmt.Errorf("软链接外接镜像到 Lima 失败: %w", err)
			if rollbackErr != nil {
				cause = fmt.Errorf("%v；恢复内部数据盘失败: %w", cause, rollbackErr)
			}
			return cleanupCreatedImage(cause)
		}
	}

	if err := config.Update(cfg, func(updated *config.Config) error {
		updated.Storage.SelectedDisk = diskID
		updated.Storage.MountPoint = mountPoint
		updated.Storage.DataPath = imgFile
		return nil
	}); err != nil {
		if !managedLink {
			if removeErr := os.Remove(targetDatadisk); removeErr != nil && !os.IsNotExist(removeErr) {
				return "", fmt.Errorf("保存配置失败: %v；清理外接盘链接失败: %w", err, removeErr)
			}
		}
		if movedInternal {
			if restoreErr := os.Rename(backupPath, targetDatadisk); restoreErr != nil {
				return "", fmt.Errorf("保存配置失败: %v；恢复内部数据盘失败: %w", err, restoreErr)
			}
		}
		if createdImage && !managedLink {
			if removeErr := os.Remove(imgFile); removeErr != nil && !os.IsNotExist(removeErr) {
				return "", fmt.Errorf("保存配置失败: %v；清理新建镜像失败: %w", err, removeErr)
			}
		}
		return "", fmt.Errorf("保存外接盘绑定配置失败: %w", err)
	}
	InvalidateDisksCache()

	return imgFile, nil
}

// UnbindExternalDisk restores internal disk and cleans symlink
func UnbindExternalDisk(cfg *config.Config) error {
	if cfg == nil {
		return fmt.Errorf("配置不能为空")
	}
	storageMu.Lock()
	defer storageMu.Unlock()
	cfgSnapshot, err := config.Snapshot(cfg)
	if err != nil {
		return fmt.Errorf("读取存储配置失败: %w", err)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dataDiskName, err := config.NormalizeDataDiskName(cfgSnapshot.VM.DataDiskName)
	if err != nil {
		return err
	}
	limaDiskDir := filepath.Join(home, ".lima", "_disks", dataDiskName)
	targetDatadisk := filepath.Join(limaDiskDir, "datadisk")
	backupPath := filepath.Join(limaDiskDir, "datadisk.internal.bak")
	removedLink := false
	restoredInternal := false
	var linkTarget string

	if fi, err := os.Lstat(targetDatadisk); err == nil {
		if fi.Mode()&os.ModeSymlink == 0 {
			return fmt.Errorf("Lima 数据盘目标不是 MacBox 管理的链接，未执行解除绑定")
		}
		if strings.TrimSpace(cfgSnapshot.Storage.DataPath) == "" || !sameLinkTargetPath(targetDatadisk, cfgSnapshot.Storage.DataPath) {
			return fmt.Errorf("Lima 数据盘链接与当前配置不一致，未执行解除绑定")
		}
		resolvedTarget, err := filepath.EvalSymlinks(targetDatadisk)
		if err != nil {
			rawTarget, readErr := os.Readlink(targetDatadisk)
			if readErr != nil {
				return fmt.Errorf("解析数据盘链接失败: %w", err)
			}
			if !filepath.IsAbs(rawTarget) {
				rawTarget = filepath.Join(filepath.Dir(targetDatadisk), rawTarget)
			}
			resolvedTarget, err = filepath.Abs(rawTarget)
			if err != nil {
				return fmt.Errorf("解析数据盘链接目标失败: %w", err)
			}
		}
		linkTarget = resolvedTarget
		if backupInfo, backupErr := os.Lstat(backupPath); backupErr == nil {
			if backupInfo.IsDir() || !backupInfo.Mode().IsRegular() {
				return fmt.Errorf("内部数据盘备份不是普通文件，未执行恢复")
			}
		} else if !os.IsNotExist(backupErr) {
			return fmt.Errorf("检查内部数据盘备份失败: %w", backupErr)
		}
		if err := os.Remove(targetDatadisk); err != nil {
			return fmt.Errorf("移除外接盘链接失败: %w", err)
		}
		removedLink = true
		if _, backupErr := os.Lstat(backupPath); backupErr == nil {
			if err := os.Rename(backupPath, targetDatadisk); err != nil {
				if restoreErr := os.Symlink(linkTarget, targetDatadisk); restoreErr != nil {
					return fmt.Errorf("恢复内部数据盘失败: %v；恢复外接盘链接也失败: %w", err, restoreErr)
				}
				return fmt.Errorf("恢复内部数据盘失败: %w", err)
			}
			restoredInternal = true
		}
	} else if os.IsNotExist(err) {
		if strings.TrimSpace(cfgSnapshot.Storage.DataPath) != "" {
			return fmt.Errorf("Lima 数据盘链接不存在，未执行解除绑定")
		}
	} else {
		return fmt.Errorf("检查 Lima 数据盘目标失败: %w", err)
	}

	if err := config.Update(cfg, func(updated *config.Config) error {
		updated.Storage.SelectedDisk = ""
		updated.Storage.MountPoint = ""
		updated.Storage.DataPath = ""
		return nil
	}); err != nil {
		if restoredInternal {
			if restoreErr := os.Rename(targetDatadisk, backupPath); restoreErr != nil {
				return fmt.Errorf("保存配置失败: %v；回滚内部数据盘失败: %w", err, restoreErr)
			}
		}
		if removedLink {
			if linkErr := os.Symlink(linkTarget, targetDatadisk); linkErr != nil {
				return fmt.Errorf("保存配置失败: %v；回滚外接盘链接失败: %w", err, linkErr)
			}
		}
		return fmt.Errorf("保存解除绑定配置失败: %w", err)
	}

	InvalidateDisksCache()
	return nil
}

// BindSecondaryDisk configures a secondary physical disk as high-speed Volume 2
func BindSecondaryDisk(cfg *config.Config, diskID, mountPoint, targetDir, guestTarget, projectRoot, instanceName string) (map[string]interface{}, error) {
	return BindSecondaryDiskContext(context.Background(), cfg, diskID, mountPoint, targetDir, guestTarget, projectRoot, instanceName)
}

// BindSecondaryDiskContext is the request-aware variant. The legacy wrapper is
// retained for embedded callers, while HTTP requests can cancel the Lima
// helper if the client disconnects.
func BindSecondaryDiskContext(ctx context.Context, cfg *config.Config, diskID, mountPoint, targetDir, guestTarget, projectRoot, instanceName string) (map[string]interface{}, error) {
	if cfg == nil {
		return nil, fmt.Errorf("配置不能为空")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	storageMu.Lock()
	defer storageMu.Unlock()
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(diskID) != "" {
		normalized, err := NormalizeDiskIdentifier(diskID)
		if err != nil {
			return nil, err
		}
		diskID = normalized
	}
	if diskID == "" && strings.TrimSpace(mountPoint) == "" && strings.TrimSpace(targetDir) == "" {
		return nil, fmt.Errorf("必须选择磁盘或提供存储目录")
	}
	if strings.TrimSpace(diskID) != "" || strings.TrimSpace(mountPoint) != "" {
		resolved, err := resolveDiskMountPointContext(ctx, diskID, mountPoint, "第二硬盘挂载")
		if err != nil {
			return nil, err
		}
		mountPoint = resolved
		if isSystemHelperMountPoint(mountPoint) {
			return nil, fmt.Errorf("选中的挂载点是 macOS 系统辅助卷（%s），请选择可写的数据卷", mountPoint)
		}
	}

	providedTargetDir := strings.TrimSpace(targetDir)
	if providedTargetDir != "" && !filepath.IsAbs(providedTargetDir) {
		return nil, fmt.Errorf("第二存储卷目录必须使用绝对路径")
	}
	// A legacy client used to prefill <mountPoint>/MacBox-SSD-Pool. That is
	// not writable for an internal macOS volume reported as /Volumes/Data;
	// transparently migrate that exact default to the user's home directory.
	// Explicit custom paths remain subject to the normal volume-boundary checks.
	diskIsExternal := true
	if diskID != "" {
		if disks, listErr := ListDisksContext(ctx, diskID); listErr == nil {
			for _, disk := range disks {
				if disk.DeviceIdentifier == diskID || disk.DeviceNode == "/dev/"+diskID {
					diskIsExternal = disk.IsExternal
					break
				}
			}
		}
	}
	legacyDefault := mountPoint != "" && filepath.Clean(providedTargetDir) == filepath.Join(filepath.Clean(mountPoint), "MacBox-SSD-Pool")
	if targetDir == "" || (!diskIsExternal && legacyDefault) {
		targetDir = recommendedSecondaryTargetDir(mountPoint, diskIsExternal)
		if targetDir == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return nil, err
			}
			targetDir = filepath.Join(home, "MacBox-SSD-Pool")
		}
	}

	targetDir, err = filepath.Abs(strings.TrimSpace(targetDir))
	if err != nil || targetDir == "." || targetDir == "/" {
		return nil, fmt.Errorf("第二存储卷目录无效")
	}
	if strings.IndexFunc(targetDir, unicode.IsControl) >= 0 || len(targetDir) > 4096 {
		return nil, fmt.Errorf("第二存储卷目录无效")
	}
	allowHomeTarget := !diskIsExternal || mountPoint == "/System/Volumes/Data"
	if err := validateStorageTargetDir(targetDir, mountPoint, home, allowHomeTarget); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(targetDir, 0750); err != nil {
		return nil, fmt.Errorf("创建存储空间 2 目录失败: %w", err)
	}
	if err := os.Chmod(targetDir, 0750); err != nil {
		return nil, fmt.Errorf("保护存储空间 2 目录失败: %w", err)
	}
	if info, err := os.Lstat(targetDir); err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, fmt.Errorf("第二存储卷目录必须是普通目录")
	}

	if guestTarget == "" {
		guestTarget = "volume2-ssd"
	}
	normalizedGuestTarget, err := config.NormalizeGuestTarget(guestTarget)
	if err != nil {
		return nil, err
	}
	guestTarget = normalizedGuestTarget
	if instanceName == "" {
		instanceName = "macbox"
	}
	instanceName, err = config.NormalizeVMName(instanceName)
	if err != nil {
		return nil, err
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

	if err := config.Update(cfg, func(updated *config.Config) error {
		if err := upsertLocalMount(updated, mount); err != nil {
			return err
		}
		updated.Storage.SecondaryDisk = diskID
		updated.Storage.SecondaryMount = targetDir
		return nil
	}); err != nil {
		return nil, fmt.Errorf("保存第二存储卷配置失败: %w", err)
	}
	InvalidateDisksCache()

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "mkdir", "-p", "/data/"+guestTarget)
	if err := cmd.Run(); err != nil {
		log.Printf("[MacBox Storage] 第二存储卷目录将在虚拟机重启时创建: %v", err)
	}

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
	if cfg == nil {
		return fmt.Errorf("配置不能为空")
	}
	storageMu.Lock()
	defer storageMu.Unlock()

	if err := config.Update(cfg, func(updated *config.Config) error {
		deleteLocalMount(updated, "volume2-ssd")
		updated.Storage.SecondaryDisk = ""
		updated.Storage.SecondaryMount = ""
		return nil
	}); err != nil {
		return fmt.Errorf("保存解除第二存储卷配置失败: %w", err)
	}
	InvalidateDisksCache()
	return nil
}
