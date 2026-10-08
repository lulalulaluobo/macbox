package apps

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type FNOSAppEntry struct {
	AppName     string `json:"appname"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	HomepageURL string `json:"homepage_url"`
	Version     string `json:"version"`
	ServicePort int    `json:"service_port"`
	IconURL     string `json:"icon_url"`
	Category    string `json:"category"`
	AppType     string `json:"app_type"`
}

type FNOSAppsResponse struct {
	Apps []FNOSAppEntry `json:"apps"`
}

type CommunityStoreManager struct {
	cachePath string
	mu        sync.RWMutex
	cached    []BuiltinAppDefinition
}

const maxCommunityCatalogBytes = 16 << 20

func boundedCommunityText(value string, maxBytes int) string {
	value = strings.TrimSpace(value)
	if len([]byte(value)) <= maxBytes {
		return value
	}
	runes := []rune(value)
	end := maxBytes
	if end > len(runes) {
		end = len(runes)
	}
	for end > 0 && len([]byte(string(runes[:end]))) > maxBytes {
		end--
	}
	return strings.TrimSpace(string(runes[:end]))
}

func NewCommunityStoreManager(dataDir string) *CommunityStoreManager {
	_ = os.MkdirAll(dataDir, 0700)
	_ = os.Chmod(dataDir, 0700)
	cachePath := filepath.Join(dataDir, "appstore_cache.json")
	mgr := &CommunityStoreManager{
		cachePath: cachePath,
	}
	mgr.loadCache()
	if len(mgr.cached) == 0 {
		// Populate initial extensive community catalog
		mgr.cached = GetExtensiveCommunityPresets()
		if err := mgr.saveCache(); err != nil {
			log.Printf("[AppStore] failed to save initial catalog cache: %v", err)
		}
	}
	return mgr
}

func (sm *CommunityStoreManager) loadCache() {
	data, err := os.ReadFile(sm.cachePath)
	if err != nil {
		return
	}
	_ = os.Chmod(sm.cachePath, 0600)
	var list []BuiltinAppDefinition
	if err := json.Unmarshal(data, &list); err == nil && len(list) > 0 {
		sm.cached = list
	}
}

func (sm *CommunityStoreManager) saveCache() error {
	data, err := json.MarshalIndent(sm.cached, "", "  ")
	if err != nil {
		return err
	}
	tmpFile, err := os.CreateTemp(filepath.Dir(sm.cachePath), ".appstore_cache-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmpFile.Chmod(0600); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, sm.cachePath); err != nil {
		return err
	}
	return os.Chmod(sm.cachePath, 0600)
}

func (sm *CommunityStoreManager) GetApps() []BuiltinAppDefinition {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return append([]BuiltinAppDefinition(nil), sm.cached...)
}

// Sync fetches the latest community app catalog from fnOS third-party repos & mirrors
func (sm *CommunityStoreManager) Sync(ctx context.Context) (int, error) {
	urls := []string{
		"https://raw.githubusercontent.com/conversun/fnos-apps/main/apps.json",
		"https://ghfast.top/https://raw.githubusercontent.com/conversun/fnos-apps/main/apps.json",
		"https://cdn.jsdelivr.net/gh/conversun/fnos-apps@main/apps.json",
	}

	client := &http.Client{Timeout: 12 * time.Second}
	var fetchedData []byte

	for _, u := range urls {
		req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", "MacBox-AppStore/1.0")
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxCommunityCatalogBytes+1))
		closeErr := resp.Body.Close()
		if resp.StatusCode == http.StatusOK && readErr == nil && closeErr == nil && len(data) > 0 && len(data) <= maxCommunityCatalogBytes {
			fetchedData = data
			break
		}
	}

	appMap := make(map[string]BuiltinAppDefinition)
	// Seed with extensive presets first
	for _, app := range GetExtensiveCommunityPresets() {
		appMap[app.Metadata.ID] = app
	}

	// Parse remote fnOS apps.json if available
	if len(fetchedData) > 0 {
		var fnosResp FNOSAppsResponse
		if err := json.Unmarshal(fetchedData, &fnosResp); err == nil && len(fnosResp.Apps) > 0 {
			for _, item := range fnosResp.Apps {
				item.AppName = boundedCommunityText(item.AppName, 64)
				if item.AppName == "" {
					continue
				}
				id := strings.ToLower(strings.TrimSpace(item.AppName))
				if !validAppID.MatchString(id) {
					continue
				}
				// Skip if already in built-in core (e.g. jellyfin, alist)
				if id == "jellyfin" || id == "filebrowser" || id == "syncthing" || id == "qbittorrent" {
					continue
				}

				cat := mapFNOSCategory(item.Category)
				port := item.ServicePort
				if port <= 0 || port > 65535 {
					port = 8080
				}

				displayName := boundedCommunityText(item.DisplayName, 256)
				if displayName == "" {
					displayName = item.AppName
				}

				desc := boundedCommunityText(item.Description, 2048)
				if desc == "" {
					desc = fmt.Sprintf("开源社区精选 MacBox 应用: %s", displayName)
				}

				icon := mapFNOSIcon(boundedCommunityText(item.Category, 64), id)

				// Infer docker image
				imageName := inferDockerImage(id)
				composeYAML := fmt.Sprintf(`services:
  %s:
    image: %s
    container_name: macbox-%s
    restart: unless-stopped
    ports:
      - "%d:%d"
    volumes:
      - /data/appdata/%s/config:/config
      - /data/appdata/%s/data:/data
    environment:
      - TZ=Asia/Shanghai
`, id, imageName, id, port, port, id, id)

				meta := AppMetadata{
					ID:          id,
					Name:        displayName,
					Description: desc,
					Version:     boundedCommunityText(item.Version, 64),
					Icon:        icon,
					Category:    cat,
					Port:        port,
					Ports: []AppPort{
						{
							HostPort:      port,
							ContainerPort: port,
							Protocol:      "tcp",
							Description:   fmt.Sprintf("WebUI 访问端口 (%d)", port),
						},
					},
					Volumes: []AppVolume{
						{
							Host:        fmt.Sprintf("/data/appdata/%s/config", id),
							Container:   "/config",
							Description: "应用设置",
						},
						{
							Host:        fmt.Sprintf("/data/appdata/%s/data", id),
							Container:   "/data",
							Description: "应用数据",
						},
					},
					Source: "community",
				}

				appMap[id] = BuiltinAppDefinition{
					Metadata: meta,
					YAML:     composeYAML,
				}
			}
		}
	}

	var merged []BuiltinAppDefinition
	for _, app := range appMap {
		merged = append(merged, app)
	}

	sm.mu.Lock()
	previous := sm.cached
	sm.cached = merged
	saveErr := sm.saveCache()
	if saveErr != nil {
		sm.cached = previous
	}
	sm.mu.Unlock()
	if saveErr != nil {
		return 0, fmt.Errorf("保存应用商店缓存失败: %w", saveErr)
	}

	return len(merged), nil
}

func mapFNOSCategory(cat string) string {
	switch strings.ToLower(cat) {
	case "content", "media", "video", "audio":
		return "影音娱乐"
	case "download", "downloader":
		return "下载工具"
	case "storage", "cloud", "file":
		return "私有云盘"
	case "network", "net":
		return "网络工具"
	case "system", "sys", "admin":
		return "系统运维"
	case "iot", "smart_home", "home":
		return "智能家居"
	default:
		return "实用工具"
	}
}

func mapFNOSIcon(cat, id string) string {
	lowerId := strings.ToLower(id)
	if strings.Contains(lowerId, "pdf") || strings.Contains(lowerId, "tool") || strings.Contains(lowerId, "draw") {
		return "sliders"
	}
	if strings.Contains(lowerId, "music") || strings.Contains(lowerId, "audio") || strings.Contains(lowerId, "navidrome") {
		return "music"
	}
	if strings.Contains(lowerId, "video") || strings.Contains(lowerId, "plex") || strings.Contains(lowerId, "emby") {
		return "film"
	}
	if strings.Contains(lowerId, "down") || strings.Contains(lowerId, "aria") || strings.Contains(lowerId, "trans") {
		return "download"
	}
	if strings.Contains(lowerId, "cloud") || strings.Contains(lowerId, "disk") {
		return "cloud"
	}
	if strings.Contains(lowerId, "guard") || strings.Contains(lowerId, "pass") || strings.Contains(lowerId, "warden") {
		return "shield"
	}
	if strings.Contains(lowerId, "kuma") || strings.Contains(lowerId, "monitor") || strings.Contains(lowerId, "glance") {
		return "activity"
	}
	switch strings.ToLower(cat) {
	case "content", "media":
		return "film"
	case "download":
		return "download"
	case "storage":
		return "folder"
	case "network":
		return "shield"
	case "system":
		return "activity"
	default:
		return "box"
	}
}

func inferDockerImage(id string) string {
	switch id {
	case "adguardhome":
		return "adguard/adguardhome:latest"
	case "1panel":
		return "moqsien/1panel:latest"
	case "ani-rss":
		return "anirss/ani-rss:latest"
	case "transmission":
		return "linuxserver/transmission:latest"
	case "aria2-pro":
		return "p3terx/aria2-pro:latest"
	case "nextcloud":
		return "nextcloud:latest"
	case "cloudreve":
		return "cloudreve/cloudreve:latest"
	case "stirling-pdf":
		return "frooodle/s-pdf:latest"
	case "calibre-web":
		return "linuxserver/calibre-web:latest"
	case "komga":
		return "gotson/komga:latest"
	case "emby":
		return "emby/embyserver:latest"
	case "plex":
		return "linuxserver/plex:latest"
	case "dozzle":
		return "amir20/dozzle:latest"
	case "portainer":
		return "portainer/portainer-ce:latest"
	case "homepage":
		return "ghcr.io/gethomepage/homepage:latest"
	case "homer":
		return "b4bz/homer:latest"
	case "glances":
		return "nicolargo/glances:latest"
	case "rustdesk":
		return "rustdesk/rustdesk-server:latest"
	case "mosquitto":
		return "eclipse-mosquitto:latest"
	case "node-red":
		return "nodered/node-red:latest"
	default:
		return fmt.Sprintf("%s/%s:latest", id, id)
	}
}

// Extensive high-quality presets ready offline
func GetExtensiveCommunityPresets() []BuiltinAppDefinition {
	return []BuiltinAppDefinition{
		// 1. Vaultwarden
		{
			Metadata: AppMetadata{
				ID:          "vaultwarden",
				Name:        "Vaultwarden",
				Description: "保存密码并在多个设备间同步",
				Version:     "1.30.5",
				Icon:        "shield",
				Category:    "实用工具",
				Port:        8086,
				Ports: []AppPort{
					{HostPort: 8086, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/vaultwarden/data", Container: "/data", Description: "密码数据"},
				},
				Source: "community",
			},
			YAML: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: macbox-vaultwarden
    restart: unless-stopped
    ports:
      - "8086:80"
    volumes:
      - /data/appdata/vaultwarden/data:/data
    environment:
      - WEBSOCKET_ENABLED=true
      - SIGNUPS_ALLOWED=true
`,
		},

		// 2. Uptime Kuma
		{
			Metadata: AppMetadata{
				ID:          "uptime-kuma",
				Name:        "Uptime Kuma",
				Description: "查看服务是否正常，异常时提醒",
				Version:     "1.23.13",
				Icon:        "activity",
				Category:    "监控运维",
				Port:        3001,
				Ports: []AppPort{
					{HostPort: 3001, ContainerPort: 3001, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/uptime-kuma/data", Container: "/app/data", Description: "监控数据"},
				},
				Source: "community",
			},
			YAML: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: macbox-uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - /data/appdata/uptime-kuma/data:/app/data
`,
		},

		// 3. AdGuard Home
		{
			Metadata: AppMetadata{
				ID:          "adguardhome",
				Name:        "AdGuard Home",
				Description: "为家庭设备拦截广告和跟踪请求",
				Version:     "0.107.52",
				Icon:        "shield",
				Category:    "网络工具",
				Port:        3080,
				Ports: []AppPort{
					{HostPort: 3080, ContainerPort: 3000, Protocol: "tcp", Description: "网页管理"},
					{HostPort: 53, ContainerPort: 53, Protocol: "udp", Description: "地址查询"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/adguardhome/work", Container: "/opt/adguardhome/work", Description: "拦截数据"},
					{Host: "/data/appdata/adguardhome/conf", Container: "/opt/adguardhome/conf", Description: "过滤设置"},
				},
				Source: "community",
			},
			YAML: `services:
  adguardhome:
    image: adguard/adguardhome:latest
    container_name: macbox-adguardhome
    restart: unless-stopped
    ports:
      - "3080:3000"
      - "53:53/tcp"
      - "53:53/udp"
    volumes:
      - /data/appdata/adguardhome/work:/opt/adguardhome/work
      - /data/appdata/adguardhome/conf:/opt/adguardhome/conf
`,
		},

		// 4. Navidrome
		{
			Metadata: AppMetadata{
				ID:          "navidrome",
				Name:        "Navidrome",
				Description: "管理音乐库，在手机和电脑上听歌",
				Version:     "0.53.1",
				Icon:        "music",
				Category:    "影音娱乐",
				Port:        4533,
				Ports: []AppPort{
					{HostPort: 4533, ContainerPort: 4533, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/navidrome/data", Container: "/data", Description: "音乐数据"},
					{Host: "/data/media", Container: "/music", Description: "音乐目录"},
				},
				Source: "community",
			},
			YAML: `services:
  navidrome:
    image: deluan/navidrome:latest
    container_name: macbox-navidrome
    restart: unless-stopped
    ports:
      - "4533:4533"
    volumes:
      - /data/appdata/navidrome/data:/data
      - /data/media:/music:ro
    environment:
      - ND_SCANSCHEDULE=1h
      - ND_LOGLEVEL=info
`,
		},

		// 5. IT-Tools
		{
			Metadata: AppMetadata{
				ID:          "it-tools",
				Name:        "IT-Tools",
				Description: "在线处理文本、编码和二维码",
				Version:     "2024.5",
				Icon:        "sliders",
				Category:    "实用工具",
				Port:        8088,
				Ports: []AppPort{
					{HostPort: 8088, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: nil,
				Source:  "community",
			},
			YAML: `services:
  it-tools:
    image: corentinth/it-tools:latest
    container_name: macbox-it-tools
    restart: unless-stopped
    ports:
      - "8088:80"
`,
		},

		// 6. Dozzle
		{
			Metadata: AppMetadata{
				ID:          "dozzle",
				Name:        "Dozzle",
				Description: "实时查看各个应用的运行记录",
				Version:     "latest",
				Icon:        "box",
				Category:    "监控运维",
				Port:        8888,
				Ports: []AppPort{
					{HostPort: 8888, ContainerPort: 8080, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/var/run/docker.sock", Container: "/var/run/docker.sock", Description: "应用控制"},
				},
				Source: "community",
			},
			YAML: `services:
  dozzle:
    image: amir20/dozzle:latest
    container_name: macbox-dozzle
    restart: unless-stopped
    ports:
      - "8888:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
`,
		},

		// 7. Portainer
		{
			Metadata: AppMetadata{
				ID:          "portainer",
				Name:        "Portainer CE",
				Description: "在网页中管理应用、存储和网络",
				Version:     "2.21.3",
				Icon:        "box",
				Category:    "系统运维",
				Port:        9000,
				Ports: []AppPort{
					{HostPort: 9000, ContainerPort: 9000, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/var/run/docker.sock", Container: "/var/run/docker.sock", Description: "应用控制"},
					{Host: "/data/appdata/portainer/data", Container: "/data", Description: "应用数据"},
				},
				Source: "community",
			},
			YAML: `services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: macbox-portainer
    restart: unless-stopped
    ports:
      - "9000:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /data/appdata/portainer/data:/data
`,
		},

		// 8. 1Panel
		{
			Metadata: AppMetadata{
				ID:          "1panel",
				Name:        "1Panel",
				Description: "管理网站、数据库、备份和系统状态",
				Version:     "v1.10.x",
				Icon:        "sliders",
				Category:    "系统运维",
				Port:        10086,
				Ports: []AppPort{
					{HostPort: 10086, ContainerPort: 10086, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/1panel/data", Container: "/opt", Description: "应用数据"},
					{Host: "/var/run/docker.sock", Container: "/var/run/docker.sock", Description: "应用控制"},
				},
				Source: "community",
			},
			YAML: `services:
  1panel:
    image: moqsien/1panel:latest
    container_name: macbox-1panel
    restart: unless-stopped
    ports:
      - "10086:10086"
    volumes:
      - /data/appdata/1panel/data:/opt
      - /var/run/docker.sock:/var/run/docker.sock
`,
		},

		// 9. Transmission
		{
			Metadata: AppMetadata{
				ID:          "transmission",
				Name:        "Transmission",
				Description: "远程管理种子下载和下载速度",
				Version:     "4.0.5",
				Icon:        "download",
				Category:    "下载工具",
				Port:        9091,
				Ports: []AppPort{
					{HostPort: 9091, ContainerPort: 9091, Protocol: "tcp", Description: "网页管理"},
					{HostPort: 51413, ContainerPort: 51413, Protocol: "tcp", Description: "下载连接"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/transmission/config", Container: "/config", Description: "应用设置"},
					{Host: "/data/downloads", Container: "/downloads", Description: "下载目录"},
				},
				Source: "community",
			},
			YAML: `services:
  transmission:
    image: linuxserver/transmission:latest
    container_name: macbox-transmission
    restart: unless-stopped
    ports:
      - "9091:9091"
      - "51413:51413"
      - "51413:51413/udp"
    volumes:
      - /data/appdata/transmission/config:/config
      - /data/downloads:/downloads
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
`,
		},

		// 10. Aria2 + AriaNg
		{
			Metadata: AppMetadata{
				ID:          "aria2-pro",
				Name:        "Aria2 Pro",
				Description: "远程管理多种下载任务",
				Version:     "latest",
				Icon:        "download",
				Category:    "下载工具",
				Port:        6880,
				Ports: []AppPort{
					{HostPort: 6880, ContainerPort: 6880, Protocol: "tcp", Description: "网页管理"},
					{HostPort: 6800, ContainerPort: 6800, Protocol: "tcp", Description: "下载控制"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/aria2/config", Container: "/config", Description: "应用设置"},
					{Host: "/data/downloads", Container: "/downloads", Description: "下载目录"},
				},
				Source: "community",
			},
			YAML: `services:
  aria2:
    image: p3terx/aria2-pro:latest
    container_name: macbox-aria2
    restart: unless-stopped
    ports:
      - "6800:6800"
    volumes:
      - /data/appdata/aria2/config:/config
      - /data/downloads:/downloads
    environment:
      - RPC_SECRET=__GENERATED_AT_INSTALL__
      - RPC_PORT=6800
      - LISTEN_PORT=6888
  ariang:
    image: p3terx/ariang:latest
    container_name: macbox-ariang
    restart: unless-stopped
    ports:
      - "6880:6880"
`,
		},

		// 11. Stirling-PDF
		{
			Metadata: AppMetadata{
				ID:          "stirling-pdf",
				Name:        "Stirling-PDF",
				Description: "拆分、合并、转换和压缩PDF文件",
				Version:     "0.31.2",
				Icon:        "sliders",
				Category:    "实用工具",
				Port:        8087,
				Ports: []AppPort{
					{HostPort: 8087, ContainerPort: 8080, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/stirling-pdf/training", Container: "/usr/share/tessdata", Description: "识字模型"},
					{Host: "/data/appdata/stirling-pdf/extra", Container: "/extraConfigs", Description: "扩展设置"},
				},
				Source: "community",
			},
			YAML: `services:
  stirling-pdf:
    image: frooodle/s-pdf:latest
    container_name: macbox-stirling-pdf
    restart: unless-stopped
    ports:
      - "8087:8080"
    volumes:
      - /data/appdata/stirling-pdf/training:/usr/share/tessdata
      - /data/appdata/stirling-pdf/extra:/extraConfigs
    environment:
      - DOCKER_ENABLE_SECURITY=false
      - INSTALL_BOOK_AND_ADVANCED_HTML_OPS=false
`,
		},

		// 12. Calibre-Web
		{
			Metadata: AppMetadata{
				ID:          "calibre-web",
				Name:        "Calibre-Web",
				Description: "管理电子书，在网页中阅读",
				Version:     "0.6.22",
				Icon:        "folder",
				Category:    "实用工具",
				Port:        8083,
				Ports: []AppPort{
					{HostPort: 8083, ContainerPort: 8083, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/calibre-web/config", Container: "/config", Description: "阅读数据"},
					{Host: "/data/files/books", Container: "/books", Description: "电子书库"},
				},
				Source: "community",
			},
			YAML: `services:
  calibre-web:
    image: linuxserver/calibre-web:latest
    container_name: macbox-calibre-web
    restart: unless-stopped
    ports:
      - "8083:8083"
    volumes:
      - /data/appdata/calibre-web/config:/config
      - /data/files/books:/books
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
`,
		},

		// 13. Homepage
		{
			Metadata: AppMetadata{
				ID:          "homepage",
				Name:        "Homepage",
				Description: "集中查看应用状态和系统信息",
				Version:     "v0.9.11",
				Icon:        "activity",
				Category:    "系统运维",
				Port:        3000,
				Ports: []AppPort{
					{HostPort: 3000, ContainerPort: 3000, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/homepage/config", Container: "/app/config", Description: "页面设置"},
					{Host: "/var/run/docker.sock", Container: "/var/run/docker.sock", Description: "应用状态"},
				},
				Source: "community",
			},
			YAML: `services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    container_name: macbox-homepage
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /data/appdata/homepage/config:/app/config
      - /var/run/docker.sock:/var/run/docker.sock:ro
`,
		},

		// 14. Nextcloud
		{
			Metadata: AppMetadata{
				ID:          "nextcloud",
				Name:        "Nextcloud Hub",
				Description: "同步文件，协作编辑文档和日程",
				Version:     "29.0.3",
				Icon:        "cloud",
				Category:    "私有云盘",
				Port:        8080,
				Ports: []AppPort{
					{HostPort: 8080, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/nextcloud/html", Container: "/var/www/html", Description: "应用程序"},
					{Host: "/data/files/nextcloud", Container: "/var/www/html/data", Description: "网盘文件"},
				},
				Source: "community",
			},
			YAML: `services:
  nextcloud:
    image: nextcloud:latest
    container_name: macbox-nextcloud
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - /data/appdata/nextcloud/html:/var/www/html
      - /data/files/nextcloud:/var/www/html/data
`,
		},

		// 15. Cloudreve
		{
			Metadata: AppMetadata{
				ID:          "cloudreve",
				Name:        "Cloudreve",
				Description: "管理文件、连接网盘并分享链接",
				Version:     "3.8.3",
				Icon:        "cloud",
				Category:    "私有云盘",
				Port:        5212,
				Ports: []AppPort{
					{HostPort: 5212, ContainerPort: 5212, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/cloudreve/uploads", Container: "/cloudreve/uploads", Description: "网盘文件"},
					{Host: "/data/appdata/cloudreve/data", Container: "/cloudreve/data", Description: "应用设置"},
				},
				Source: "community",
			},
			YAML: `services:
  cloudreve:
    image: cloudreve/cloudreve:latest
    container_name: macbox-cloudreve
    restart: unless-stopped
    ports:
      - "5212:5212"
    volumes:
      - /data/appdata/cloudreve/uploads:/cloudreve/uploads
      - /data/appdata/cloudreve/data:/cloudreve/data
`,
		},

		// 16. Ani-RSS
		{
			Metadata: AppMetadata{
				ID:          "ani-rss",
				Name:        "ANI-RSS 追番助手",
				Description: "订阅动画更新，自动下载和整理",
				Version:     "latest",
				Icon:        "film",
				Category:    "影音娱乐",
				Port:        7789,
				Ports: []AppPort{
					{HostPort: 7789, ContainerPort: 7789, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/ani-rss/config", Container: "/config", Description: "订阅设置"},
					{Host: "/data/downloads", Container: "/downloads", Description: "动画目录"},
				},
				Source: "community",
			},
			YAML: `services:
  ani-rss:
    image: wushang/ani-rss:latest
    container_name: macbox-ani-rss
    restart: unless-stopped
    ports:
      - "7789:7789"
    volumes:
      - /data/appdata/ani-rss/config:/config
      - /data/downloads:/downloads
`,
		},

		// 17. Nginx Proxy Manager
		{
			Metadata: AppMetadata{
				ID:          "nginx-proxy-manager",
				Name:        "Nginx Proxy Manager",
				Description: "管理网站访问地址和加密证书",
				Version:     "2.11.2",
				Icon:        "shield",
				Category:    "网络工具",
				Port:        81,
				Ports: []AppPort{
					{HostPort: 81, ContainerPort: 81, Protocol: "tcp", Description: "网页管理"},
					{HostPort: 80, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
					{HostPort: 443, ContainerPort: 443, Protocol: "tcp", Description: "加密访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/npm/data", Container: "/data", Description: "转发设置"},
					{Host: "/data/appdata/npm/letsencrypt", Container: "/etc/letsencrypt", Description: "网站证书"},
				},
				Source: "community",
			},
			YAML: `services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: macbox-npm
    restart: unless-stopped
    ports:
      - "80:80"
      - "81:81"
      - "443:443"
    volumes:
      - /data/appdata/npm/data:/data
      - /data/appdata/npm/letsencrypt:/etc/letsencrypt
`,
		},

		// 18. Home Assistant
		{
			Metadata: AppMetadata{
				ID:          "home-assistant",
				Name:        "Home Assistant",
				Description: "连接家中智能设备，设置自动操作",
				Version:     "2024.5",
				Icon:        "activity",
				Category:    "智能家居",
				Port:        8123,
				Ports: []AppPort{
					{HostPort: 8123, ContainerPort: 8123, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/homeassistant/config", Container: "/config", Description: "家居设置"},
				},
				Source: "community",
			},
			YAML: `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: macbox-homeassistant
    restart: unless-stopped
    ports:
      - "8123:8123"
    volumes:
      - /data/appdata/homeassistant/config:/config
    environment:
      - TZ=Asia/Shanghai
`,
		},

		// 19. Audiobookshelf
		{
			Metadata: AppMetadata{
				ID:          "audiobookshelf",
				Name:        "Audiobookshelf",
				Description: "管理有声书和播客，同步收听进度",
				Version:     "v2.10.1",
				Icon:        "music",
				Category:    "影音娱乐",
				Port:        13378,
				Ports: []AppPort{
					{HostPort: 13378, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/audiobookshelf/config", Container: "/config", Description: "收听数据"},
					{Host: "/data/appdata/audiobookshelf/metadata", Container: "/metadata", Description: "听书资料"},
					{Host: "/data/media", Container: "/audiobooks", Description: "听书目录"},
				},
				Source: "community",
			},
			YAML: `services:
  audiobookshelf:
    image: ghcr.io/advplyr/audiobookshelf:latest
    container_name: macbox-audiobookshelf
    restart: unless-stopped
    ports:
      - "13378:80"
    volumes:
      - /data/appdata/audiobookshelf/config:/config
      - /data/appdata/audiobookshelf/metadata:/metadata
      - /data/media:/audiobooks
`,
		},
	}
}
