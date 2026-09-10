# MacNAS 参考项目与架构映射指南

本文档根据《MacNAS MVP PRD v0.1》的需求，对 7 个重点参考开源项目进行职责划分、核心源码路径定位与架构映射。

---

## 1. 总体参考关系拓扑

```text
MacNAS 核心模块与参考开源项目
│
├── 1. VM Manager (虚拟机生命周期与编排)
│      └── 参考：Lima + Colima
│          - 核心职责：Lima VM 创建/启动/停止/删除、Managed Disk、数据盘挂载、网络与端口转发、Docker Socket 暴露
│
├── 2. Docker Engine & Compose Manager (容器编排与日志)
│      └── 参考：Dockge
│          - 核心职责：基于真实 compose.yaml 目录管理应用；容器生命周期、启动/停止/重启、实时日志流 (WebSocket)
│
├── 3. Storage Manager (存储盘与文件系统管理)
│      └── 参考：Cockpit (cockpit-storaged)
│          - 核心职责：外接存储设备自动识别、结构化磁盘状态提取、ext4 / managed disk 挂载管理
│
├── 4. App Store (预设应用与模板格式)
│      └── 参考：BigBear Dockge
│          - 核心职责：apps/{app_id}/compose.yaml + app.json 结构化元数据；零侵入扩展应用
│
├── 5. File & Share Service (NAS 共享与权限)
│      └── 参考：copyparty / SFTPGo
│          - 核心职责：Samba 配置生成与管理（/data 暴露为 smb://<ip>/MacNAS）、单用户权限模型
│
└── 6. UI / UX Design (产品体验与交互界面)
       └── 参考：CasaOS
           - 核心职责：极简家庭服务器 Dashboard、4 页面极简布局（首页/存储/Docker/应用）、非技术用户友好
```

---

## 2. 各项目深度剖析与源码参考路径

### 2.1 Lima (`references/lima`) —— P0：底层 VM 与硬件交互
- **定位**：macOS 上的 Linux 虚拟机引擎（底层支持 Apple Virtualization.framework 与 QEMU）。
- **学习重点**：
  - **Docker Socket 转发**：如何将 Linux VM 内部的 `/var/run/docker.sock` 转发至 macOS 宿主机本地用户目录。
  - **磁盘管理与挂载**：`additionalDisks` 与 Managed Disk 机制，避免长期在 VirtioFS 上跑数据库产生性能与一致性问题。
  - **配置模板**：`templates/default.yaml` 与 `templates/docker.yaml`。
- **关键代码/目录**：
  - `pkg/limayaml/`：Lima YAML 配置的数据模型与校验。
  - `pkg/instance/`：VM 实例管理逻辑（启动、检查、停止）。
  - `pkg/hostagent/`：宿主机 Agent，处理端口转发与 socket 代理。
  - `templates/`：内置实例模板。

### 2.2 Colima (`references/colima`) —— P0：Lima 的高阶封装与 Docker Runtime 体验
- **定位**：将复杂且繁琐的 Lima 配置封装为类似 Docker Desktop 体验的极简 CLI。
- **学习重点**：
  - **Go 语言调用与封装**：Colima 本身是 Go 语言开发，它展示了如何在 Go 中编排 Lima 配置、启动检查、超时重试与异常恢复。
  - **环境检测与自动修复**：检查 macOS 环境依赖、Socket 联通性、SSH 通道健康度。
- **关键代码/目录**：
  - `cmd/`：CLI 命令入口与参数设计。
  - `environment/`：宿主机与客机运行时交互。
  - `config/`：Lima 默认运行时参数与硬件分配。

### 2.3 Dockge (`references/dockge`) —— P0：极简 Docker Compose 面板
- **定位**：围绕纯原生 `compose.yaml` 构建的轻量容器管理系统。
- **学习重点**：
  - **去中心化存储**：每一个服务是一个独立的文件夹，内部存放标准的 `compose.yaml`，没有任何私有数据库锁定。
  - **实时状态与日志交互**：通过 WebSocket 实现容器终端输出、启动进度与状态实时回传。
  - **Compose 生命周期管理**：`docker compose up -d`、`down`、`restart`、`logs` 的封装。
- **关键代码/目录**：
  - `backend/`：Node.js 后端与 Docker/Compose 进程封装。
  - `frontend/`：轻量级响应式面板设计。
  - `common/`：协议与数据模型。

### 2.4 CasaOS (`references/CasaOS`) —— P0：家庭服务器产品化交互
- **定位**：专为家庭私有云用户设计的轻量 Web 操作系统。
- **学习重点**：
  - **零技术门槛 Dashboard**：直观的 CPU/内存利用率仪表盘、磁盘容量百分比条、快速进入应用的卡片（WebUI 入口、运行状态点）。
  - **应用卡片设计**：状态指示灯、端口自动识别、快捷打开与操作菜单。
- **关键代码/目录**：
  - `service/`：Go 编写的核心服务 API。
  - 交互设计规范：状态概览、存储卡片、单应用操作。

### 2.5 Cockpit (`references/cockpit`) —— P1：存储盘抽象与交互
- **定位**：Linux 服务器成熟的管理界面，存储管理模块极具参考性。
- **学习重点**：
  - **存储信息抽象**：物理盘 -> 分区/文件系统 -> 挂载点状态，以结构化 JSON 提供给 UI。
  - **操作交互**：格式化/选择数据盘、挂载/卸载、容量进度条展示。
- **关键代码/目录**：
  - `pkg/storaged/`：存储设备识别与挂载逻辑。

### 2.6 BigBear Dockge (`references/big-bear-dockge`) —— P1：应用商店模板标准
- **定位**：庞大的 Dockge 应用模板库。
- **学习重点**：
  - **规范化模板结构**：
    ```text
    apps/
    ├── jellyfin/
    │   ├── compose.yaml
    │   └── app.json
    ├── syncthing/
    │   ├── compose.yaml
    │   └── app.json
    └── filebrowser/
        ├── compose.yaml
        └── app.json
    ```
  - **环境变量与端口暴露规范**：在 `app.json` 中声明名称、图标、分类、默认端口、数据卷目录绑定（如 `/data/media`、`/data/appdata`）。

### 2.7 copyparty / SFTPGo (`references/copyparty` & `references/sftpgo`) —— P1：文件共享与权限
- **定位**：轻量级、多协议文件服务器。
- **学习重点**：
  - **权限与共享模型**：单用户/多用户共享配置、路径映射、Samba 服务集成配置生成。
  - **网络发现**：mDNS 局域网广播支持，方便用户直接在 Mac Finder 或 Windows 网络中发现 `smb://MacNAS.local`。

---

## 3. MacNAS MVP 落地实现规划

根据 PRD，MacNAS MVP 聚焦在核心闭环：
1. **统一控制中枢 (Go Backend)**：负责运行 HTTP API + WebSocket，统一编排 Lima、Docker 与 Samba。
2. **Web 前端 (React + Tailwind)**：4 个页面——「首页（Dashboard）」、「存储（含 SMB 设置）」、「Docker（容器与日志）」、「应用（Jellyfin/Syncthing/FileBrowser 快速部署）」。
3. **VM 与容器底座**：
   - 使用 Lima 托管 Linux 虚拟机（内置 Docker Engine 与 Samba）。
   - Linux 内部以 Managed Disk 作为 `/data`（含 `media`, `files`, `appdata`）。
   - 暴露 host-forwarded Docker Socket 与 SMB 445 端口。
