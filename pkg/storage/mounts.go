package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/luluen/mac-nas/pkg/config"
)

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
		if fi, err := os.Stat(fullPath); err == nil && fi.IsDir() {
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
	}

	return defaults
}

// ListLocalMounts returns current active mounts and unadded recommendations
func ListLocalMounts(cfg *config.Config) (configured []config.LocalMount, recommended []config.LocalMount) {
	configured = cfg.Storage.LocalMounts
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

// AddOrUpdateLocalMount validates and saves a local directory mount
func AddOrUpdateLocalMount(cfg *config.Config, mount config.LocalMount) error {
	// Expand ~ if present
	if strings.HasPrefix(mount.HostPath, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		mount.HostPath = filepath.Join(home, strings.TrimPrefix(mount.HostPath, "~"))
	}

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
	if mount.Name == "" {
		mount.Name = filepath.Base(mount.HostPath)
	}
	if mount.GuestTarget == "" {
		cleanBase := filepath.Base(mount.HostPath)
		mount.GuestTarget = "shared/" + cleanBase
	}
	// Sanitize guest target to be relative to /data
	mount.GuestTarget = strings.TrimPrefix(mount.GuestTarget, "/data/")
	mount.GuestTarget = strings.TrimPrefix(mount.GuestTarget, "/")

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

	return config.SaveConfig(cfg)
}

// ToggleLocalMount toggles the enabled status of a mount
func ToggleLocalMount(cfg *config.Config, id string) (bool, error) {
	for i, m := range cfg.Storage.LocalMounts {
		if m.ID == id {
			cfg.Storage.LocalMounts[i].Enabled = !m.Enabled
			err := config.SaveConfig(cfg)
			return cfg.Storage.LocalMounts[i].Enabled, err
		}
	}
	return false, fmt.Errorf("未找到指定的直通挂载: %s", id)
}

// DeleteLocalMount removes a mount from config
func DeleteLocalMount(cfg *config.Config, id string) error {
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
		return fmt.Errorf("未找到指定的直通挂载: %s", id)
	}
	cfg.Storage.LocalMounts = updated
	return config.SaveConfig(cfg)
}
