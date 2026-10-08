export interface ComposeTemplate {
  id: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  defaultProjectName: string;
  yaml: string;
}

export const PRESET_COMPOSE_TEMPLATES: ComposeTemplate[] = [
  {
    id: 'nginx',
    brand: 'Nginx',
    name: "网站服务",
    category: '网络工具',
    description: "运行网站并转发访问请求",
    defaultProjectName: 'my-nginx',
    yaml: `version: '3.8'
services:
  web:
    image: nginx:alpine
    container_name: macbox-my-nginx
    restart: unless-stopped
    ports:
      - "8088:80"
    volumes:
      - /data/appdata/compose/my-nginx/html:/usr/share/nginx/html:ro
`,
  },
  {
    id: 'redis',
    brand: 'Redis',
    name: "内存缓存",
    category: '数据库',
    description: "用内存暂存数据，加快读取",
    defaultProjectName: 'my-redis',
    yaml: `version: '3.8'
services:
  redis:
    image: redis:alpine
    container_name: macbox-my-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - /data/appdata/compose/my-redis/data:/data
    command: redis-server --appendonly yes
`,
  },
  {
    id: 'postgres',
    brand: 'PostgreSQL',
    name: "数据存储",
    category: '数据库',
    description: "保存和查询应用数据",
    defaultProjectName: 'my-postgres',
    yaml: `version: '3.8'
services:
  db:
    image: postgres:16-alpine
    container_name: macbox-my-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: macbox
      POSTGRES_PASSWORD: macbox_password_change_me
      POSTGRES_DB: defaultdb
    ports:
      - "5432:5432"
    volumes:
      - /data/appdata/compose/my-postgres/data:/var/lib/postgresql/data
`,
  },
  {
    id: 'uptime-kuma',
    brand: 'Uptime Kuma',
    name: "服务监控",
    category: '运维监控',
    description: "查看服务是否正常，异常时提醒",
    defaultProjectName: 'my-uptime-kuma',
    yaml: `version: '3.8'
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: macbox-uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - /data/appdata/compose/my-uptime-kuma/data:/app/data
`,
  },
  {
    id: 'vaultwarden',
    brand: 'Vaultwarden',
    name: "密码管理",
    category: '安全工具',
    description: "保存密码并在多个设备间同步",
    defaultProjectName: 'my-vaultwarden',
    yaml: `version: '3.8'
services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: macbox-vaultwarden
    restart: unless-stopped
    ports:
      - "8085:80"
    volumes:
      - /data/appdata/compose/my-vaultwarden/data:/data
    environment:
      WEBSOCKET_ENABLED: "true"
`,
  },
  {
    id: 'qbittorrent',
    brand: 'qBittorrent',
    name: "种子下载",
    category: '下载工具',
    description: "在网页中管理种子下载",
    defaultProjectName: 'my-qbittorrent',
    yaml: `version: '3.8'
services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: macbox-qbittorrent
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
      - WEBUI_PORT=8089
    ports:
      - "8089:8089"
      - "6881:6881"
      - "6881:6881/udp"
    volumes:
      - /data/appdata/compose/my-qbittorrent/config:/config
      - /data/downloads:/downloads
`,
  }
];

export const POPULAR_IMAGES = [
  { name: 'nginx:alpine', desc: "运行网站" },
  { name: 'redis:alpine', desc: "用内存暂存数据" },
  { name: 'postgres:16-alpine', desc: "保存和查询应用数据" },
  { name: 'mysql:8.0', desc: "保存和查询应用数据" },
  { name: 'node:20-alpine', desc: "运行网页服务和脚本" },
  { name: 'python:3.11-slim', desc: "运行脚本和程序" },
  { name: 'alpine:latest', desc: "体积较小的基础系统包" },
  { name: 'ubuntu:22.04', desc: "常用的基础系统包" },
];

export const REGISTRY_PRESETS = [
  { name: "官方来源", url: 'https://registry-1.docker.io' },
  { name: "网易", url: 'https://hub-mirror.c.163.com' },
  { name: "中科大", url: 'https://docker.mirrors.ustc.edu.cn' },
  { name: "上海交大", url: 'https://docker.m.daocloud.io' },
  { name: "腾讯云", url: 'https://mirror.ccs.tencentyun.com' },
];
