package apps

// BuiltinAppDefinition defines a built-in or catalog application
type BuiltinAppDefinition struct {
	Metadata AppMetadata
	YAML     string
}

// GetBuiltinCatalog returns all curated out-of-the-box NAS applications
func GetBuiltinCatalog() []BuiltinAppDefinition {
	return []BuiltinAppDefinition{
		// 1. Jellyfin
		{
			Metadata: AppMetadata{
				ID:          "jellyfin",
				Name:        "Jellyfin",
				Description: "自由开源的流媒体影音中心，支持电影、电视剧、音乐的集中管理、海报刮削与全端串流播放。",
				Version:     "10.9.11",
				Icon:        "film",
				Category:    "影音娱乐",
				Port:        8096,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8096, ContainerPort: 8096, Protocol: "tcp", Description: "WebUI 访问与媒体串流端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/jellyfin/config", Container: "/config", Description: "Jellyfin 用户与系统配置"},
					{Host: "/data/appdata/jellyfin/cache", Container: "/cache", Description: "媒体刮削缩略图与转码缓存"},
					{Host: "/data/media", Container: "/media", Description: "电影、美剧、音乐等媒体库主目录"},
				},
			},
			YAML: `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: macnas-jellyfin
    restart: unless-stopped
    ports:
      - "8096:8096"
    volumes:
      - /data/appdata/jellyfin/config:/config
      - /data/appdata/jellyfin/cache:/cache
      - /data/media:/media
`,
		},

		// 2. Alist
		{
			Metadata: AppMetadata{
				ID:          "alist",
				Name:        "Alist",
				Description: "全能网盘聚合挂载中心，支持聚合阿里云盘、百度网盘、115、夸克、OneDrive、WebDAV 等数十种网盘到本地统一浏览与下载。",
				Version:     "3.36.0",
				Icon:        "cloud",
				Category:    "私有云盘",
				Port:        5244,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 5244, ContainerPort: 5244, Protocol: "tcp", Description: "Alist Web 管理与 WebDAV 端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/alist/data", Container: "/opt/alist/data", Description: "Alist 存储配置与 SQLite 数据库"},
					{Host: "/data", Container: "/data", Description: "本地存储挂载穿透目录"},
				},
				Env: []AppEnv{
					{Key: "PUID", Value: "0", Description: "用户 ID"},
					{Key: "PGID", Value: "0", Description: "用户组 ID"},
					{Key: "UMASK", Value: "022", Description: "文件掩码"},
				},
			},
			YAML: `services:
  alist:
    image: xhofe/alist:latest
    container_name: macnas-alist
    restart: unless-stopped
    ports:
      - "5244:5244"
    volumes:
      - /data/appdata/alist/data:/opt/alist/data
      - /data:/data
    environment:
      - PUID=0
      - PGID=0
      - UMASK=022
`,
		},

		// 3. FileBrowser
		{
			Metadata: AppMetadata{
				ID:          "filebrowser",
				Name:        "FileBrowser",
				Description: "现代、轻量、高颜值的 Web 文件管理器，支持在线文件浏览、上传下载、文件分享与音视频直接预览。",
				Version:     "2.30.0",
				Icon:        "folder",
				Category:    "私有云盘",
				Port:        8082,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8082, ContainerPort: 80, Protocol: "tcp", Description: "Web 文件管理主界面端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/filebrowser/database.db", Container: "/database/filebrowser.db", Description: "用户与权限数据库文件"},
					{Host: "/data/appdata/filebrowser/config.json", Container: "/config/settings.json", Description: "主配置文件"},
					{Host: "/data", Container: "/srv", Description: "浏览与管理的存储根路径"},
				},
			},
			YAML: `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    container_name: macnas-filebrowser
    restart: unless-stopped
    ports:
      - "8082:80"
    volumes:
      - /data/appdata/filebrowser/database.db:/database/filebrowser.db
      - /data/appdata/filebrowser/config.json:/config/settings.json
      - /data:/srv
`,
		},

		// 4. qBittorrent
		{
			Metadata: AppMetadata{
				ID:          "qbittorrent",
				Name:        "qBittorrent",
				Description: "强大、高带宽利用率的离线 BT/PT 种子下载器，支持远程 Web 管理、RSS 自动订阅与磁力链高速离线下载。",
				Version:     "4.6.5",
				Icon:        "download",
				Category:    "下载工具",
				Port:        8085,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8085, ContainerPort: 8085, Protocol: "tcp", Description: "WebUI 远程下载控制界面"},
					{HostPort: 6881, ContainerPort: 6881, Protocol: "tcp", Description: "BT 传入连接端口 (TCP)"},
					{HostPort: 6881, ContainerPort: 6881, Protocol: "udp", Description: "BT 传入连接端口 (UDP)"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/qbittorrent/config", Container: "/config", Description: "qBittorrent 客户端配置文件"},
					{Host: "/data/downloads", Container: "/downloads", Description: "文件下载保存目录（可选用物理硬盘）"},
				},
				Env: []AppEnv{
					{Key: "WEBUI_PORT", Value: "8085", Description: "Web 控制台端口"},
					{Key: "TZ", Value: "Asia/Shanghai", Description: "系统时区"},
				},
			},
			YAML: `services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: macnas-qbittorrent
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
      - WEBUI_PORT=8085
    ports:
      - "8085:8085"
      - "6881:6881"
      - "6881:6881/udp"
    volumes:
      - /data/appdata/qbittorrent/config:/config
      - /data/downloads:/downloads
`,
		},

		// 5. Syncthing
		{
			Metadata: AppMetadata{
				ID:          "syncthing",
				Name:        "Syncthing",
				Description: "连续、安全且去中心化的文件同步工具，在多台电脑、手机与 NAS 之间点对点加密实时同步文件。",
				Version:     "1.27.12",
				Icon:        "refresh-cw",
				Category:    "私有云盘",
				Port:        8384,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8384, ContainerPort: 8384, Protocol: "tcp", Description: "Web 控制台管理端口"},
					{HostPort: 22000, ContainerPort: 22000, Protocol: "tcp", Description: "设备间数据同步监听 (TCP)"},
					{HostPort: 21027, ContainerPort: 21027, Protocol: "udp", Description: "局域网设备发现广播 (UDP)"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/syncthing", Container: "/var/syncthing", Description: "配置与证书数据库"},
					{Host: "/data/files", Container: "/var/syncthing/files", Description: "同步数据根目录"},
				},
			},
			YAML: `services:
  syncthing:
    image: syncthing/syncthing:latest
    container_name: macnas-syncthing
    restart: unless-stopped
    ports:
      - "8384:8384"
      - "22000:22000/tcp"
      - "22000:22000/udp"
      - "21027:21027/udp"
    volumes:
      - /data/appdata/syncthing:/var/syncthing
      - /data/files:/var/syncthing/files
`,
		},

		// 6. Vaultwarden
		{
			Metadata: AppMetadata{
				ID:          "vaultwarden",
				Name:        "Vaultwarden",
				Description: "用 Rust 编写的高性能轻量 Bitwarden 兼容密码管理器，支持全平台客户端安全同步、密码填充与双重认证。",
				Version:     "1.32.0",
				Icon:        "shield",
				Category:    "实用工具",
				Port:        8086,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 8086, ContainerPort: 80, Protocol: "tcp", Description: "Web 密码库与 API 同步端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/vaultwarden/data", Container: "/data", Description: "加密密码数据库与附件存储"},
				},
				Env: []AppEnv{
					{Key: "WEBSOCKET_ENABLED", Value: "true", Description: "启用客户端实时推送"},
					{Key: "SIGNUPS_ALLOWED", Value: "true", Description: "允许用户注册 (首次创建账号后建议关闭)"},
				},
			},
			YAML: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: macnas-vaultwarden
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

		// 7. Uptime Kuma
		{
			Metadata: AppMetadata{
				ID:          "uptime-kuma",
				Name:        "Uptime Kuma",
				Description: "界面极度优雅的自建服务健康状态监控面板，支持 HTTP/HTTPS、TCP、Ping 等心跳监控与多渠道告警。",
				Version:     "1.23.13",
				Icon:        "activity",
				Category:    "实用工具",
				Port:        3001,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 3001, ContainerPort: 3001, Protocol: "tcp", Description: "监控状态大盘 Web 端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/uptime-kuma/data", Container: "/app/data", Description: "监控历史与通知配置数据库"},
				},
			},
			YAML: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: macnas-uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - /data/appdata/uptime-kuma/data:/app/data
`,
		},

		// 8. Navidrome
		{
			Metadata: AppMetadata{
				ID:          "navidrome",
				Name:        "Navidrome",
				Description: "现代、超轻量的个人音乐流媒体服务器，兼容 Subsonic/Airsonic 协议，多端随时畅听无损高保真音乐。",
				Version:     "0.53.1",
				Icon:        "music",
				Category:    "影音娱乐",
				Port:        4533,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 4533, ContainerPort: 4533, Protocol: "tcp", Description: "WebUI 音乐播放与 API 端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/navidrome/data", Container: "/data", Description: "歌单、喜好与数据库"},
					{Host: "/data/media/music", Container: "/music", Description: "本地无损音乐文件主目录"},
				},
			},
			YAML: `services:
  navidrome:
    image: deluan/navidrome:latest
    container_name: macnas-navidrome
    restart: unless-stopped
    ports:
      - "4533:4533"
    environment:
      - ND_SCANSCHEDULE=1h
      - ND_LOGLEVEL=info
    volumes:
      - /data/appdata/navidrome/data:/data
      - /data/media/music:/music:ro
`,
		},

		// 9. Nginx Proxy Manager
		{
			Metadata: AppMetadata{
				ID:          "nginx-proxy-manager",
				Name:        "Nginx Proxy Manager",
				Description: "简单直观的 Nginx 反向代理可视化控制台，轻松配置公网域名穿透、SSL 免费证书自动申请与续期。",
				Version:     "2.11.3",
				Icon:        "network",
				Category:    "实用工具",
				Port:        81,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 81, ContainerPort: 81, Protocol: "tcp", Description: "Web 可视化管理后台端口"},
					{HostPort: 8080, ContainerPort: 80, Protocol: "tcp", Description: "HTTP 代理流量转发端口"},
					{HostPort: 8443, ContainerPort: 443, Protocol: "tcp", Description: "HTTPS 加密流量转发端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/npm/data", Container: "/data", Description: "反向代理规则配置与 SQLite 库"},
					{Host: "/data/appdata/npm/letsencrypt", Container: "/etc/letsencrypt", Description: "Let's Encrypt SSL 证书存储"},
				},
			},
			YAML: `services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: macnas-npm
    restart: unless-stopped
    ports:
      - "81:81"
      - "8080:80"
      - "8443:443"
    volumes:
      - /data/appdata/npm/data:/data
      - /data/appdata/npm/letsencrypt:/etc/letsencrypt
`,
		},

		// 10. IT-Tools
		{
			Metadata: AppMetadata{
				ID:          "it-tools",
				Name:        "IT-Tools",
				Description: "为开发者与运维工程师打造的极其实用的在线瑞士军刀工具箱（Base64、JSON格式化、哈希生成、二维码、Docker转换等）。",
				Version:     "2024.5",
				Icon:        "code",
				Category:    "实用工具",
				Port:        8088,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 8088, ContainerPort: 80, Protocol: "tcp", Description: "WebUI 工具箱访问端口"},
				},
			},
			YAML: `services:
  it-tools:
    image: corentinth/it-tools:latest
    container_name: macnas-it-tools
    restart: unless-stopped
    ports:
      - "8088:80"
`,
		},

		// 11. Home Assistant
		{
			Metadata: AppMetadata{
				ID:          "home-assistant",
				Name:        "Home Assistant",
				Description: "全球最著名的开源智能家居自动化控制中心，聚合米家、Apple HomeKit、Aqara、涂鸦等全屋智能设备。",
				Version:     "2024.9",
				Icon:        "home",
				Category:    "实用工具",
				Port:        8123,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 8123, ContainerPort: 8123, Protocol: "tcp", Description: "智能家居控制大盘端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/homeassistant", Container: "/config", Description: "设备绑定与自动化流配置"},
				},
			},
			YAML: `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: macnas-homeassistant
    restart: unless-stopped
    privileged: true
    environment:
      - TZ=Asia/Shanghai
    ports:
      - "8123:8123"
    volumes:
      - /data/appdata/homeassistant:/config
      - /etc/localtime:/etc/localtime:ro
`,
		},

		// 12. Audiobookshelf
		{
			Metadata: AppMetadata{
				ID:          "audiobookshelf",
				Name:        "Audiobookshelf",
				Description: "自建有声书与播客管理串流服务器，支持章节标记、进度跨设备同步以及 iOS/Android 客户端串流收听。",
				Version:     "2.12.3",
				Icon:        "headphones",
				Category:    "影音娱乐",
				Port:        13378,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 13378, ContainerPort: 80, Protocol: "tcp", Description: "有声书 WebUI 访问端口"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/audiobookshelf/config", Container: "/config", Description: "配置与元数据"},
					{Host: "/data/appdata/audiobookshelf/metadata", Container: "/metadata", Description: "播客封面与音频缓存"},
					{Host: "/data/media/audiobooks", Container: "/audiobooks", Description: "有声书音频文件存放目录"},
				},
			},
			YAML: `services:
  audiobookshelf:
    image: ghcr.io/advplyr/audiobookshelf:latest
    container_name: macnas-audiobookshelf
    restart: unless-stopped
    ports:
      - "13378:80"
    volumes:
      - /data/appdata/audiobookshelf/config:/config
      - /data/appdata/audiobookshelf/metadata:/metadata
      - /data/media/audiobooks:/audiobooks
`,
		},
	}
}
