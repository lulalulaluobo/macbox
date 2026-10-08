package apps

// BuiltinAppDefinition defines a built-in or catalog application
type BuiltinAppDefinition struct {
	Metadata AppMetadata
	YAML     string
}

// GetBuiltinCatalog returns all curated out-of-the-box MacBox applications
func GetBuiltinCatalog() []BuiltinAppDefinition {
	return []BuiltinAppDefinition{
		// 1. Jellyfin
		{
			Metadata: AppMetadata{
				ID:          "jellyfin",
				Name:        "Jellyfin",
				Description: "管理电影、剧集和音乐，随时播放",
				Version:     "10.9.11",
				Icon:        "film",
				Category:    "影音娱乐",
				Port:        8096,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8096, ContainerPort: 8096, Protocol: "tcp", Description: "媒体访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/jellyfin/config", Container: "/config", Description: "应用设置"},
					{Host: "/data/appdata/jellyfin/cache", Container: "/cache", Description: "播放缓存"},
					{Host: "/data/media", Container: "/media", Description: "媒体目录"},
				},
			},
			YAML: `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: macbox-jellyfin
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
				Description: "在一处浏览和下载多个网盘的文件",
				Version:     "3.36.0",
				Icon:        "cloud",
				Category:    "私有云盘",
				Port:        5244,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 5244, ContainerPort: 5244, Protocol: "tcp", Description: "文件访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/alist/data", Container: "/opt/alist/data", Description: "应用设置"},
					{Host: "/data", Container: "/data", Description: "本机文件"},
				},
				Env: []AppEnv{
					{Key: "PUID", Value: "0", Description: "账号编号"},
					{Key: "PGID", Value: "0", Description: "组别编号"},
					{Key: "UMASK", Value: "022", Description: "文件权限"},
				},
			},
			YAML: `services:
  alist:
    image: xhofe/alist:latest
    container_name: macbox-alist
    restart: unless-stopped
    ports:
      - "5244:5244"
    volumes:
      - /data/appdata/alist/data:/opt/alist/data
      - type: bind
        source: /data
        target: /data
        bind:
          propagation: rslave
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
				Description: "在网页中浏览、上传、下载和分享文件",
				Version:     "2.30.0",
				Icon:        "folder",
				Category:    "私有云盘",
				Port:        8082,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8082, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/filebrowser/database.db", Container: "/database/filebrowser.db", Description: "账号权限"},
					{Host: "/data/appdata/filebrowser/config.json", Container: "/config/settings.json", Description: "应用设置"},
					{Host: "/data", Container: "/srv", Description: "文件目录"},
				},
			},
			YAML: `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    container_name: macbox-filebrowser
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
				Description: "远程管理种子下载和自动订阅",
				Version:     "4.6.5",
				Icon:        "download",
				Category:    "下载工具",
				Port:        8085,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8085, ContainerPort: 8085, Protocol: "tcp", Description: "网页管理"},
					{HostPort: 6881, ContainerPort: 6881, Protocol: "tcp", Description: "下载连接"},
					{HostPort: 6881, ContainerPort: 6881, Protocol: "udp", Description: "下载连接"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/qbittorrent/config", Container: "/config", Description: "应用设置"},
					{Host: "/data/downloads", Container: "/downloads", Description: "下载目录"},
				},
				Env: []AppEnv{
					{Key: "WEBUI_PORT", Value: "8085", Description: "网页管理"},
					{Key: "TZ", Value: "Asia/Shanghai", Description: "系统时区"},
				},
			},
			YAML: `services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: macbox-qbittorrent
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
				Description: "让多台电脑和手机自动同步文件",
				Version:     "1.27.12",
				Icon:        "refresh-cw",
				Category:    "私有云盘",
				Port:        8384,
				Source:      "builtin",
				Ports: []AppPort{
					{HostPort: 8384, ContainerPort: 8384, Protocol: "tcp", Description: "网页管理"},
					{HostPort: 22000, ContainerPort: 22000, Protocol: "tcp", Description: "文件同步"},
					{HostPort: 21027, ContainerPort: 21027, Protocol: "udp", Description: "发现设备"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/syncthing", Container: "/var/syncthing", Description: "同步设置"},
					{Host: "/data/files", Container: "/var/syncthing/files", Description: "同步目录"},
				},
			},
			YAML: `services:
  syncthing:
    image: syncthing/syncthing:latest
    container_name: macbox-syncthing
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
				Description: "保存密码并在多个设备间同步",
				Version:     "1.32.0",
				Icon:        "shield",
				Category:    "实用工具",
				Port:        8086,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 8086, ContainerPort: 80, Protocol: "tcp", Description: "密码同步"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/vaultwarden/data", Container: "/data", Description: "密码数据"},
				},
				Env: []AppEnv{
					{Key: "WEBSOCKET_ENABLED", Value: "true", Description: "实时通知"},
					{Key: "SIGNUPS_ALLOWED", Value: "true", Description: "允许注册"},
				},
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

		// 7. Uptime Kuma
		{
			Metadata: AppMetadata{
				ID:          "uptime-kuma",
				Name:        "Uptime Kuma",
				Description: "查看服务是否正常，异常时提醒",
				Version:     "1.23.13",
				Icon:        "activity",
				Category:    "实用工具",
				Port:        3001,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 3001, ContainerPort: 3001, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/uptime-kuma/data", Container: "/app/data", Description: "监控数据"},
				},
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

		// 8. Navidrome
		{
			Metadata: AppMetadata{
				ID:          "navidrome",
				Name:        "Navidrome",
				Description: "管理音乐库，在手机和电脑上听歌",
				Version:     "0.53.1",
				Icon:        "music",
				Category:    "影音娱乐",
				Port:        4533,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 4533, ContainerPort: 4533, Protocol: "tcp", Description: "音乐访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/navidrome/data", Container: "/data", Description: "音乐数据"},
					{Host: "/data/media/music", Container: "/music", Description: "音乐目录"},
				},
			},
			YAML: `services:
  navidrome:
    image: deluan/navidrome:latest
    container_name: macbox-navidrome
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
				Description: "管理网站访问地址和加密证书",
				Version:     "2.11.3",
				Icon:        "network",
				Category:    "实用工具",
				Port:        81,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 81, ContainerPort: 81, Protocol: "tcp", Description: "网页管理"},
					{HostPort: 8080, ContainerPort: 80, Protocol: "tcp", Description: "网页转发"},
					{HostPort: 8443, ContainerPort: 443, Protocol: "tcp", Description: "加密转发"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/npm/data", Container: "/data", Description: "转发设置"},
					{Host: "/data/appdata/npm/letsencrypt", Container: "/etc/letsencrypt", Description: "网站证书"},
				},
			},
			YAML: `services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: macbox-npm
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
				Description: "在线处理文本、编码和二维码",
				Version:     "2024.5",
				Icon:        "code",
				Category:    "实用工具",
				Port:        8088,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 8088, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
				},
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

		// 11. Home Assistant
		{
			Metadata: AppMetadata{
				ID:          "home-assistant",
				Name:        "Home Assistant",
				Description: "连接家中智能设备，设置自动操作",
				Version:     "2024.9",
				Icon:        "home",
				Category:    "实用工具",
				Port:        8123,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 8123, ContainerPort: 8123, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/homeassistant", Container: "/config", Description: "家居设置"},
				},
			},
			YAML: `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: macbox-homeassistant
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
				Description: "管理有声书和播客，同步收听进度",
				Version:     "2.12.3",
				Icon:        "headphones",
				Category:    "影音娱乐",
				Port:        13378,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 13378, ContainerPort: 80, Protocol: "tcp", Description: "网页访问"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/audiobookshelf/config", Container: "/config", Description: "应用设置"},
					{Host: "/data/appdata/audiobookshelf/metadata", Container: "/metadata", Description: "播放缓存"},
					{Host: "/data/media/audiobooks", Container: "/audiobooks", Description: "听书目录"},
				},
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
      - /data/media/audiobooks:/audiobooks
			`,
		},

		// 13. Docker Compose / Dockge
		// Compose itself is the Docker orchestration CLI/specification, so the
		// store exposes Dockge as the installable web UI for managing Compose
		// stacks. The Docker socket and /data mount are intentional and must
		// remain clearly visible in the install dialog.
		{
			Metadata: AppMetadata{
				ID:          "dockge",
				Name:        "Docker Compose（Dockge）",
				Description: "管理多个应用的安装配置。\n可控制全部应用，请仅供管理员使用。",
				Version:     "1.x",
				Icon:        "layers",
				Category:    "系统运维",
				Port:        5001,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 5001, ContainerPort: 5001, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/var/run/docker.sock", Container: "/var/run/docker.sock", Description: "应用控制"},
					{Host: "/data/appdata/dockge/data", Container: "/app/data", Description: "应用设置"},
					{Host: "/data", Container: "/data", Description: "组合目录"},
				},
				Env: []AppEnv{
					{Key: "DOCKGE_STACKS_DIR", Value: "/data/appdata", Description: "组合目录"},
				},
			},
			YAML: `services:
  dockge:
    image: louislam/dockge:1
    container_name: macbox-dockge
    restart: unless-stopped
    ports:
      - "5001:5001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /data/appdata/dockge/data:/app/data
      - /data:/data
    environment:
      - DOCKGE_STACKS_DIR=/data/appdata
`,
		},

		// 14. Xunlei
		{
			Metadata: AppMetadata{
				ID:          "xunlei",
				Name:        "迅雷下载",
				Description: "远程管理迅雷下载和保存位置。\n需要系统管理权限。\n请仅在可信的网络中使用。",
				Version:     "beta",
				Icon:        "download",
				Category:    "下载工具",
				Port:        2345,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 2345, ContainerPort: 2345, Protocol: "tcp", Description: "网页管理"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/xunlei/data", Container: "/xunlei/data", Description: "应用数据"},
					{Host: "/data/appdata/xunlei/cache", Container: "/xunlei/var/packages/pan-xunlei-com", Description: "应用缓存"},
					{Host: "/data/downloads", Container: "/xunlei/downloads", Description: "下载目录"},
				},
				Env: []AppEnv{
					{Key: "XL_UID", Value: "0", Description: "账号编号"},
					{Key: "XL_GID", Value: "0", Description: "组别编号"},
				},
			},
			YAML: `services:
  xunlei:
    image: cnk3x/xunlei:beta
    container_name: macbox-xunlei
    hostname: macbox-xunlei
    restart: unless-stopped
    cap_add:
      - SYS_ADMIN
    security_opt:
      - apparmor=unconfined
    ports:
      - "2345:2345/tcp"
    environment:
      - XL_UID=0
      - XL_GID=0
    volumes:
      - /data/downloads:/xunlei/downloads
      - /data/appdata/xunlei/data:/xunlei/data
      - /data/appdata/xunlei/cache:/xunlei/var/packages/pan-xunlei-com
`,
		},

		// 15. Baidu Netdisk
		{
			Metadata: AppMetadata{
				ID:          "baidunetdisk",
				Name:        "百度网盘",
				Description: "在网页中登录百度网盘并下载文件。\n支持两种Mac处理器机型。\n安装时会自动生成一次性连接密码。",
				Version:     "4.17.7",
				Icon:        "cloud",
				Category:    "下载工具",
				Port:        6080,
				Source:      "community",
				Ports: []AppPort{
					{HostPort: 6080, ContainerPort: 6080, Protocol: "tcp", Description: "网页访问"},
					{HostPort: 5900, ContainerPort: 5900, Protocol: "tcp", Description: "远程连接"},
				},
				Volumes: []AppVolume{
					{Host: "/data/appdata/baidunetdisk/config", Container: "/root/baidunetdisk", Description: "应用设置"},
					{Host: "/data/downloads", Container: "/root/baidunetdiskdownload", Description: "下载目录"},
				},
				Env: []AppEnv{
					{Key: "VNC_SERVER_PASSWD", Value: "macbox-change-me", Description: "连接密码"},
					{Key: "TZ", Value: "Asia/Shanghai", Description: "系统时区"},
				},
			},
			YAML: `services:
  baidunetdisk:
    image: tzuhsiao/baidunetdisk:latest
    container_name: macbox-baidunetdisk
    restart: unless-stopped
    ports:
      - "6080:6080"
      - "5900:5900"
    environment:
      - TZ=Asia/Shanghai
      - VNC_SERVER_PASSWD=macbox-change-me
    volumes:
      - /data/appdata/baidunetdisk/config:/root/baidunetdisk
      - /data/downloads:/root/baidunetdiskdownload
`,
		},
	}
}
