package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/luluen/mac-nas/pkg/config"
)

// LocalMountCandidate is a safe, shallow scan result for the folder picker in
// the Web UI. A browser cannot disclose the Mac's absolute path to a server,
// so MacNAS offers well-known user folders and first-level mounted volumes as
// selectable candidates while retaining a manual path fallback for advanced
// users.
type LocalMountCandidate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	HostPath    string `json:"hostPath"`
	Category    string `json:"category"`
	Description string `json:"description,omitempty"`
	Available   bool   `json:"available"`
	Configured  bool   `json:"configured"`
	Enabled     bool   `json:"enabled"`
	Reason      string `json:"reason,omitempty"`
}

// LocalMountHealth is the API-level desired-vs-observed contract for a mount.
// The desired state stays in config.LocalMount; these fields are recomputed
// and never persisted as they describe the current VM session.
type LocalMountHealth struct {
	ID              string    `json:"id"`
	ExpectedEnabled bool      `json:"expectedEnabled"`
	HostReady       bool      `json:"hostReady"`
	SourceMounted   bool      `json:"sourceMounted"`
	TargetMounted   bool      `json:"targetMounted"`
	Healthy         bool      `json:"healthy"`
	Status          string    `json:"status"`
	Message         string    `json:"message"`
	CheckedAt       time.Time `json:"checkedAt"`
}

// ScanLocalMountCandidates deliberately stays shallow and allowlisted. It
// never walks a user's entire home directory or an external volume, avoiding
// both latency spikes and accidental disclosure of arbitrary filesystem
// contents.
func ScanLocalMountCandidates(cfg *config.Config) []LocalMountCandidate {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	type candidateSpec struct {
		path, name, category, description string
		trustedKnownPath                  bool
	}
	specs := []candidateSpec{
		{filepath.Join(home, "Downloads"), "Downloads", "downloads", "Mac 下载目录，可映射到 /data/downloads", true},
		{filepath.Join(home, "Movies"), "Movies", "media", "Mac 影音目录，可映射到 /data/media", true},
		{filepath.Join(home, "Pictures"), "Pictures", "pictures", "Mac 照片目录，可映射到 /data/photos", true},
		{filepath.Join(home, "Documents"), "Documents", "custom", "Mac 文档目录，可映射到 /data/shared", true},
		{filepath.Join(home, "Desktop"), "Desktop", "custom", "Mac 桌面目录，可映射到 /data/shared", true},
		{filepath.Join(home, "Public"), "Public", "custom", "Mac 公共目录，可映射到 /data/shared", true},
	}
	// Do not enumerate /Volumes here. On macOS this includes network volumes
	// and causes a privacy prompt every time the storage page refreshes. A user
	// can still add an external or network volume by entering its absolute path.

	configured := make(map[string]config.LocalMount)
	if cfg != nil {
		if snapshot, snapshotErr := config.Snapshot(cfg); snapshotErr == nil {
			for _, mount := range snapshot.Storage.LocalMounts {
				configured[filepath.Clean(mount.HostPath)] = mount
			}
		}
	}
	seen := make(map[string]struct{}, len(specs))
	result := make([]LocalMountCandidate, 0, len(specs))
	for _, spec := range specs {
		cleanPath := filepath.Clean(spec.path)
		if _, ok := seen[cleanPath]; ok {
			continue
		}
		seen[cleanPath] = struct{}{}
		candidate := LocalMountCandidate{
			ID:          "candidate-" + strings.ToLower(strings.ReplaceAll(filepath.Base(cleanPath), " ", "-")),
			Name:        spec.name,
			HostPath:    cleanPath,
			Category:    spec.category,
			Description: spec.description,
		}
		if mount, ok := configured[cleanPath]; ok {
			candidate.Configured = true
			candidate.Enabled = mount.Enabled
		}
		// Do not probe macOS privacy-protected home folders while merely loading
		// the storage page. The actual add operation validates the user-selected
		// path and macOS can then request access once, in clear user context.
		if spec.trustedKnownPath {
			candidate.Available = true
			result = append(result, candidate)
			continue
		}
		info, statErr := os.Stat(cleanPath)
		if statErr != nil {
			candidate.Reason = "目录不存在或尚未挂载"
		} else if !info.IsDir() {
			candidate.Reason = "路径不是目录"
		} else if directory, openErr := os.Open(cleanPath); openErr != nil {
			candidate.Reason = "当前进程无权读取"
		} else {
			_ = directory.Close()
			candidate.Available = true
		}
		result = append(result, candidate)
	}
	return result
}

// GetDefaultMacMounts detects standard Mac user directories
func GetDefaultMacMounts() []config.LocalMount {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	candidates := []struct {
		folderName  string
		id          string
		name        string
		guestTarget string
		category    string
		description string
	}{
		{
			folderName:  "Movies",
			id:          "mac-movies",
			name:        "Mac 影音库",
			guestTarget: "media/MacMovies",
			category:    "media",
			description: "直通 Mac 本地影视目录，Jellyfin 自动索引并刮削海报墙，零拷贝播放",
		},
		{
			folderName:  "Downloads",
			id:          "mac-downloads",
			name:        "Mac 下载库",
			guestTarget: "downloads/MacDownloads",
			category:    "downloads",
			description: "直通 Mac 下载目录，FileBrowser、Alist 与离线下载器即刻在线管理",
		},
		{
			folderName:  "Pictures",
			id:          "mac-pictures",
			name:        "Mac 照片库",
			guestTarget: "photos/MacPictures",
			category:    "pictures",
			description: "直通 Mac 照片与图库，可在网页端集中浏览与分享",
		},
	}

	var defaults []config.LocalMount
	for _, c := range candidates {
		fullPath := filepath.Join(home, c.folderName)
		defaults = append(defaults, config.LocalMount{
			ID:          c.id,
			Name:        c.name,
			HostPath:    fullPath,
			GuestTarget: c.guestTarget,
			Writable:    false, // Default read-only for security
			Enabled:     false,
			Category:    c.category,
			Description: c.description,
		})
	}

	return defaults
}

// ListLocalMounts returns current active mounts and unadded recommendations
func ListLocalMounts(cfg *config.Config) (configured []config.LocalMount, recommended []config.LocalMount) {
	if cfg == nil {
		return nil, GetDefaultMacMounts()
	}
	cfgSnapshot, err := config.Snapshot(cfg)
	if err != nil {
		return nil, GetDefaultMacMounts()
	}
	configured = cloneLocalMounts(cfgSnapshot.Storage.LocalMounts)
	defaults := GetDefaultMacMounts()

	configuredIDs := make(map[string]bool)
	configuredPaths := make(map[string]bool)
	for _, m := range configured {
		configuredIDs[m.ID] = true
		configuredPaths[m.HostPath] = true
	}

	for _, d := range defaults {
		if !configuredIDs[d.ID] && !configuredPaths[d.HostPath] {
			recommended = append(recommended, d)
		}
	}

	return configured, recommended
}

func upsertLocalMount(cfg *config.Config, mount config.LocalMount) error {
	if cfg == nil {
		return fmt.Errorf("配置不能为空")
	}

	// Expand ~ if present
	if strings.HasPrefix(mount.HostPath, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		mount.HostPath = filepath.Join(home, strings.TrimPrefix(mount.HostPath, "~"))
	}
	var err error
	mount.HostPath, err = filepath.Abs(strings.TrimSpace(mount.HostPath))
	if err != nil {
		return fmt.Errorf("解析 Mac 本地路径失败: %w", err)
	}
	mount.HostPath = filepath.Clean(mount.HostPath)

	// Validate path existence
	fi, err := os.Stat(mount.HostPath)
	if err != nil {
		return fmt.Errorf("Mac 本地路径不存在: %s", mount.HostPath)
	}
	if !fi.IsDir() {
		return fmt.Errorf("指定路径不是一个目录: %s", mount.HostPath)
	}

	if mount.ID == "" {
		mount.ID = fmt.Sprintf("mount-%d", len(cfg.Storage.LocalMounts)+1)
	}
	mount.ID, err = config.NormalizeLocalMountID(mount.ID)
	if err != nil {
		return err
	}
	if mount.Name == "" {
		mount.Name = filepath.Base(mount.HostPath)
	}
	if mount.GuestTarget == "" {
		cleanBase := filepath.Base(mount.HostPath)
		mount.GuestTarget = "shared/" + cleanBase
	}
	target, err := config.NormalizeGuestTarget(mount.GuestTarget)
	if err != nil {
		return err
	}
	mount.GuestTarget = target
	if err := config.ValidateLocalMount(mount); err != nil {
		return err
	}
	for _, existing := range cfg.Storage.LocalMounts {
		if existing.ID == mount.ID {
			continue
		}
		existingTarget, targetErr := config.NormalizeGuestTarget(existing.GuestTarget)
		if targetErr != nil {
			continue
		}
		if target == existingTarget || strings.HasPrefix(target, existingTarget+"/") || strings.HasPrefix(existingTarget, target+"/") {
			return fmt.Errorf("VM 目标目录与已有挂载 %q 重叠: /data/%s", existing.Name, existingTarget)
		}
	}

	// Update if ID exists, or append
	found := false
	for i, m := range cfg.Storage.LocalMounts {
		if m.ID == mount.ID {
			cfg.Storage.LocalMounts[i] = mount
			found = true
			break
		}
	}
	if !found {
		cfg.Storage.LocalMounts = append(cfg.Storage.LocalMounts, mount)
	}

	return nil
}

func cloneLocalMounts(mounts []config.LocalMount) []config.LocalMount {
	if mounts == nil {
		return nil
	}
	return append([]config.LocalMount(nil), mounts...)
}

// AddOrUpdateLocalMount validates and saves a local directory mount.
// The in-memory change is rolled back when persistence fails.
func AddOrUpdateLocalMount(cfg *config.Config, mount config.LocalMount) error {
	if cfg == nil {
		return fmt.Errorf("配置不能为空")
	}
	storageMu.Lock()
	defer storageMu.Unlock()

	if err := config.Update(cfg, func(updated *config.Config) error {
		return upsertLocalMount(updated, mount)
	}); err != nil {
		return fmt.Errorf("保存直通目录配置失败: %w", err)
	}
	return nil
}

// ToggleLocalMount toggles the enabled status of a mount
func ToggleLocalMount(cfg *config.Config, id string) (bool, error) {
	if cfg == nil {
		return false, fmt.Errorf("配置不能为空")
	}
	storageMu.Lock()
	defer storageMu.Unlock()
	var err error
	id, err = config.NormalizeLocalMountID(id)
	if err != nil {
		return false, err
	}

	var enabled bool
	if err := config.Update(cfg, func(updated *config.Config) error {
		for i, m := range updated.Storage.LocalMounts {
			if m.ID == id {
				enabled = !m.Enabled
				updated.Storage.LocalMounts[i].Enabled = enabled
				return nil
			}
		}
		return fmt.Errorf("未找到指定的直通挂载: %s", id)
	}); err != nil {
		return false, fmt.Errorf("保存直通目录状态失败: %w", err)
	}
	return enabled, nil
}

func deleteLocalMount(cfg *config.Config, id string) bool {
	var updated []config.LocalMount
	found := false
	for _, m := range cfg.Storage.LocalMounts {
		if m.ID == id {
			found = true
			continue
		}
		updated = append(updated, m)
	}
	if !found {
		return false
	}
	cfg.Storage.LocalMounts = updated
	return true
}

// DeleteLocalMount removes a mount from config and rolls back on persistence
// failure so callers never observe an unsaved in-memory deletion.
func DeleteLocalMount(cfg *config.Config, id string) error {
	if cfg == nil {
		return fmt.Errorf("配置不能为空")
	}
	storageMu.Lock()
	defer storageMu.Unlock()
	var err error
	id, err = config.NormalizeLocalMountID(id)
	if err != nil {
		return err
	}

	if err := config.Update(cfg, func(updated *config.Config) error {
		if !deleteLocalMount(updated, id) {
			return fmt.Errorf("未找到指定的直通挂载: %s", id)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("保存删除直通目录配置失败: %w", err)
	}
	return nil
}

// ToggleLocalMountWritable updates the writable (read-only vs read-write) status of a mount
func ToggleLocalMountWritable(cfg *config.Config, id string, writable bool) (bool, error) {
	if cfg == nil {
		return false, fmt.Errorf("配置不能为空")
	}
	storageMu.Lock()
	defer storageMu.Unlock()
	var err error
	id, err = config.NormalizeLocalMountID(id)
	if err != nil {
		return false, err
	}

	var currentWritable bool
	if err := config.Update(cfg, func(updated *config.Config) error {
		for i, m := range updated.Storage.LocalMounts {
			if m.ID == id {
				updated.Storage.LocalMounts[i].Writable = writable
				currentWritable = writable
				return nil
			}
		}
		return fmt.Errorf("未找到指定的直通挂载: %s", id)
	}); err != nil {
		return false, fmt.Errorf("保存直通目录权限失败: %w", err)
	}
	return currentWritable, nil
}
