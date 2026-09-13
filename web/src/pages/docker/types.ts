export interface ComposeTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultProjectName: string;
  yaml: string;
}

export const PRESET_COMPOSE_TEMPLATES: ComposeTemplate[] = [
  {
    id: 'nginx',
    name: 'Nginx Web / 反代服务',
    category: '网络工具',
    description: '全球最流行的轻量、高性能 HTTP 服务器与反向代理服务。',
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
    name: 'Redis 极速缓存数据库',
    category: '数据库',
    description: '开源的高性能内存键值存储，常用于缓存、会话管理与消息队列。',
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
    name: 'PostgreSQL 关系型数据库',
    category: '数据库',
    description: '功能强大、高度可扩展的开源对象关系型数据库系统。',
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
    name: 'Uptime Kuma 状态监控',
    category: '运维监控',
    description: '开箱即用、界面极度优雅的服务健康心跳与在线率监控面板。',
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
    name: 'Vaultwarden 密码管理器',
    category: '安全工具',
    description: '用 Rust 编写的高性能轻量 Bitwarden 兼容服务端，全端密码同步。',
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
    name: 'qBittorrent 高速下载器',
    category: '下载工具',
    description: '经典 BT/PT 种子下载利器，配备功能完善的 Web 远程控制界面。',
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
  { name: 'nginx:alpine', desc: '轻量高性能 Web 服务' },
  { name: 'redis:alpine', desc: '极速内存缓存' },
  { name: 'postgres:16-alpine', desc: '工业级 SQL 数据库' },
  { name: 'mysql:8.0', desc: '经典关系数据库' },
  { name: 'node:20-alpine', desc: 'Node.js 运行时' },
  { name: 'python:3.11-slim', desc: 'Python 运行环境' },
  { name: 'alpine:latest', desc: '仅 5MB 的微型 Linux 镜像' },
  { name: 'ubuntu:22.04', desc: '标准 Ubuntu 基础镜像' },
];

export const REGISTRY_PRESETS = [
  { name: 'Docker Hub 官方源', url: 'https://registry-1.docker.io' },
  { name: '网易云镜像加速', url: 'https://hub-mirror.c.163.com' },
  { name: '中科大镜像加速', url: 'https://docker.mirrors.ustc.edu.cn' },
  { name: '上海交大镜像源', url: 'https://docker.m.daocloud.io' },
  { name: '腾讯云公有镜像源', url: 'https://mirror.ccs.tencentyun.com' },
];
