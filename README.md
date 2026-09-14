# MacBox

MacBox 是一个运行在 macOS 上的轻量级自托管服务中枢。它以 Web 控制台为主界面，通过 Lima Linux 虚拟机按需承载 Docker、文件管理、SMB 共享、云盘和 Web 终端；macOS 顶部菜单栏助手负责启动、停止、状态监控、日志和卸载。

MacBox 不追求成为一套大而全的家庭服务器系统：当前不提供 RAID/存储阵列、相册管理、媒体索引等能力。它的定位是一个开销尽量小的基础框架和控制面板，用户可以按需部署 Docker 服务，或直接在 VM 终端中安装自己的项目。

MacBox 采用 Apache License 2.0 发布，允许个人和组织商用、修改和再分发，具体条款见 [LICENSE](LICENSE)。

当前版本同时提供可拖入“应用程序”的 DMG，以及用于命令行部署和故障恢复的预编译压缩包。发行产物不包含开发机用户、Docker 容器、Docker 镜像、卷、Lima 实例或 MacBox 数据。

## v0.1.0 当前版本功能（2026-09-13）

这是 MacBox 的第一个可用版本，重点完成“轻量运行、按需扩展、网页管理”的基础闭环：用户可以把一台闲置 Mac 变成文件中心、应用中心和开发工作台，并通过 VM 内终端继续安装自己的项目。

### 主要页面

以下截图来自当前运行版本，使用 MacBox 内置浏览器的手机视口生成。截图中的 CPU、内存、存储和文件名是测试环境数据。

<table>
  <tr>
    <td align="center"><img src="assets/screenshots/dashboard-mobile.png" alt="MacBox 首页" width="300"><br>首页：主机状态、资源监控、服务导航</td>
    <td align="center"><img src="assets/screenshots/file-manager-mobile.png" alt="文件管理" width="300"><br>文件：磁盘、目录、收藏和文件操作</td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/docker-mobile.png" alt="Docker 管理" width="300"><br>Docker：容器、编排、镜像和网络</td>
    <td align="center"><img src="assets/screenshots/apps-mobile.png" alt="应用商城" width="300"><br>应用：应用商城与 Compose 部署</td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/web-terminal-mobile.png" alt="Web 终端" width="300"><br>Web 终端：持久化会话与 AI CLI 快捷入口</td>
    <td align="center"><img src="assets/screenshots/terminal-settings-mobile.png" alt="终端设置与 Skill 映射" width="300"><br>设置：终端身份与 AI CLI Skill 目录映射</td>
  </tr>
</table>

### 平台与启动管理

- Go 后端嵌入 React/Vite 前端，最终用户不需要安装 Node.js。
- Lima 提供 Linux 虚拟机，虚拟机内运行 Docker Engine、文件操作、SMB 和交互式终端。
- 首次启动状态机分为环境检查、虚拟机配置和服务启动阶段。
- 诊断中心检查 Lima、虚拟机、Mac 数据盘、MacBox 数据盘、SSH、Docker 和本机目录直通探针，并保留具体失败原因。
- 顶部菜单栏助手每 5 秒检测 Web 服务和资源状态，显示 CPU、内存、存储、Lima 和 Docker 状态。
- 菜单栏提供打开网页、启动/停止后端、启动/停止 Lima、刷新状态、打开日志，以及“仅卸载程序”和“彻底卸载”两级入口。

### 存储与文件管理

- 支持 MacBox 根目录、Docker 目录、第二存储空间和已挂载云盘等磁盘入口。
- 存储设置支持外置盘、本机目录直通、候选目录扫描、挂载契约和 VM 内可见性探针。
- 文件列表支持新建目录、上传、读取、重命名、复制、移动、删除、路径复制和下载。
- 常用目录可以收藏/取消收藏；收藏项在上方快速导航中显示，收藏星星使用黄色高对比度图标。
- 文件和文件夹都可以下载；文件夹会在服务端流式生成 ZIP，避免移动端依赖新窗口。
- 文件下载会先验证源文件和读取权限，避免浏览器创建 0 KB 空文件。
- 删除默认进入 `/data/.trash` 回收站，可恢复、清空；也支持从回收站安全移动到 Mac 本机 `~/.Trash`。
- 顶部任务列表显示云盘传输任务的状态、文件进度、总大小、当前文件和实时速度，并支持清理历史任务。
- 设置支持导出和恢复 MacBox 配置，第一版不包含备份密码，恢复前会保留必要的安全校验。

### 压缩与解压

- 当前仅支持 ZIP 压缩与解压。
- ZIP 使用虚拟机内 Python 标准库，开箱即用，不需要额外安装工具。
- 压缩包解压前会校验绝对路径、`..` 路径、控制字符、符号链接和特殊文件，降低路径穿越风险。

### Docker 与应用商城

- Docker 总览、容器、Compose 编排、镜像和网络页面。
- 容器支持启动、停止、重启、日志、删除；镜像支持拉取、删除和清理；Compose 支持查看、部署、启动、停止、重启、更新和删除。
- Compose 的宿主机 `ports` 会自动加入 Lima 端口转发白名单，新部署的服务默认可以通过 Mac 局域网 IP 访问，例如 `http://<Mac局域网IP>:8088`。
- 首页服务导航支持 Docker 服务与手动入口：Docker 服务与真实容器状态联动，手动入口只保存名称、地址和图标，不会影响实际服务。
- 手动服务入口支持添加、编辑、删除服务名称、访问地址和图标，适合登记通过终端或其他方式部署的服务。
- 容器右侧 `+` 可以自动读取容器名称和内网端口，选择 20 个预设图标后添加到首页；首页点击导航即可打开服务。
- 应用商城提供内置和社区 Compose 项目，可搜索、按分类筛选、查看端口/目录映射、配置并安装。
- 当前仓库包含 Dockge、File Browser、Jellyfin、Syncthing、qBittorrent、Alist、迅雷下载和百度网盘等模板；迅雷模板包含 `SYS_ADMIN` 与 `apparmor=unconfined` 配置。

### Web 终端与 AI CLI

- Web 终端支持可恢复的 Linux Shell 会话，页面刷新后仍能看到执行中的任务和历史输出。
- Docker 容器页面可以将最近日志填入终端输入框，用户确认后交给 AI CLI 分析；不会自动发送命令。
- 顶部提供 Codex CLI 快捷入口，点击后在终端中启动高权限模式：

  ```
  codex --yolo
  ```

- 在“设置 → 终端”中可以选择普通用户或 Root 默认登录身份。
- 支持配置 Mac 本机 AI Skill 目录：扫描 `~/.agents/skills`、`~/.codex/skills` 和 `~/.claude/skills`，经管理员确认后以只读方式映射到 VM 的 `/home/macboxctl/.agents/skills` 和 `/root/.agents/skills`。
- Skill 映射保存后需要重启 VM；AI CLI 和 Skill 本身需要用户预先安装并登录。

### 夸克云盘

- 文件页支持挂载夸克云盘，使用夸克官方扫码页面完成网页鉴权，不要求在 MacBox 中粘贴 Cookie、手机号密码或短信验证码。
- 挂载后作为独立云盘入口显示，可浏览目录、新建文件夹、重命名和删除云端文件。
- 支持下载单个文件、文件夹或多选项目到 MacBox 本地挂载目录，默认目标为 `/data/downloads`。
- 云盘下载在后台任务中执行，记录文件数量、总大小、完成字节数、当前文件、速度和失败原因；刷新页面后仍可查询。

## 安装与分发

### 推荐安装方式：下载 DMG 安装包（首选）

推荐直接从 [GitHub Releases](https://github.com/lulalulaluobo/macbox/releases) 页面下载匹配 Mac 芯片架构的 DMG 安装包：

- **Apple Silicon（M1/M2/M3/M4 系列芯片）**：下载 `MacBox_*_macos_aarch64.dmg`
- **Intel 芯片 Mac**：下载 `MacBox_*_macos_x86_64.dmg`

#### 安装与启动步骤

1. **拖入应用程序**：双击打开下载的 `.dmg` 镜像，将 `MacBoxMemu.app` 拖入 `Applications`（应用程序）文件夹；
2. **启动菜单栏助手**：在“启动台”或“访达 → 应用程序”中双击运行 `MacBoxMemu.app`，macOS 顶部菜单栏将出现 MacBox 图标；
3. **启动后端服务**：点击顶部菜单栏图标，选择 **“启动后端服务”**（首次运行会自动完成运行组件配置与依赖环境检查）；
4. **进入控制台初始化**：服务启动成功后，点击菜单栏的 **“打开控制台”**（或直接在浏览器访问 `http://127.0.0.1:19808`），现场设置管理员用户名与密码完成首次安全初始化。

默认地址：
- 本机：`http://127.0.0.1:19808`
- 局域网：`http://<Mac局域网IP>:19808`

> [!TIP]
> **关于 macOS 首次打开安全提示（Gatekeeper）**
> 由于开源发行包使用自签名，若 macOS 提示“无法打开，因为无法验证开发者”：
> 1. 在访达中找到 `MacBoxMemu.app`，**右键（或按住 Control 键）点击“打开”**，在弹窗中选择“打开”；
> 2. 或在 macOS“系统设置 → 隐私与安全性”中点击“仍要打开”；
> 3. 亦可在终端中单次移除该 App 的隔离属性：
>    ```bash
>    xattr -dr com.apple.quarantine /Applications/MacBoxMemu.app
>    ```

---

### 其他安装与部署方式

#### 方式一：命令行发行包安装（tar.gz）

适合无图形桌面或偏好终端管理的用户。从 GitHub Releases 下载对应架构的 `tar.gz`：

```bash
tar -xzf MacBox_*_macos_*.tar.gz
cd MacBox_*_macos_*
./install.sh --start
```

安装器会把程序安装到用户级目录 `~/.local/share/macbox`，并创建 `~/.local/bin/macbox`。它会自动检查并配置 Lima 环境。

#### 方式二：从源码构建与开发者模式

适合参与开发、调试或自行编译定制版本的用户：

```bash
git clone https://github.com/lulalulaluobo/macbox.git
cd macbox

# 构建安装包
make dmg                 # 构建双架构 DMG
make dmg-aarch64         # 仅构建 Apple Silicon DMG
make dmg-x86-64          # 仅构建 Intel DMG
make release-mac         # 构建命令行压缩包

# 本地开发调试
make build              # 构建前端并编译 bin/macbox
make dev-backend        # 启动本机开发后端
make dev-backend-lan    # 启动局域网可访问后端
make test               # 执行后端单元测试
```

若通过本地终端 Agent 协助部署，可参考仓库根目录的 [MACBOX_DEPLOYMENT_PROMPT.md](MACBOX_DEPLOYMENT_PROMPT.md) 引导流程。

## 局域网边界与安全说明

MacBox 当前定位是可信家庭局域网使用：默认使用 HTTP，外网访问需要用户自行配置 HTTPS/VPN/反向代理。HTTP 局域网模式不应直接暴露到公网。

当前已处理：

- 首次初始化仅允许本机完成，管理员密码由用户现场设置；
- API 默认拒绝未登记的 DNS Host，降低 DNS Rebinding 风险；
- AI Skill 映射使用只读挂载，并要求管理员二次确认风险；
- ZIP 解压执行路径和归档条目经过安全校验；
- 登录、上传并发和终端会话已有基础限制。

当前按内网产品边界暂缓：普通成员共享全部 MacBox 数据的细粒度 ACL、完整全局审计日志、完整供应链签名和公网级 HTTPS/限流。这些不代表 MacBox 已适合公网部署。

## 卸载与恢复初始状态

发行包中的菜单栏助手和卸载脚本区分两种操作：

```
./uninstall.sh                # 仅卸载程序，保留实例和数据
./uninstall.sh --purge        # 删除 MacBox 专属实例、镜像、配置和数据
./uninstall.sh --purge --uninstall-lima  # 同时卸载 Homebrew 安装的 Lima
```

破坏性清理需要输入 `DELETE` 确认，不会删除其他 Lima 实例、宿主机无关 Docker 数据或整个用户目录。

## 开源许可与致谢

MacBox 代码正式采用 **Apache License 2.0**，具体条款见仓库根目录的 [LICENSE](LICENSE)。

MacBox 的架构、功能边界和交互设计参考了以下优秀开源项目，感谢它们及其贡献者：

- [Lima](https://github.com/lima-vm/lima)（Apache-2.0）：macOS Linux 虚拟机、磁盘和端口转发思路。
- [Colima](https://github.com/abiosoft/colima)（MIT）：macOS 容器运行时的安装、检测和使用体验。
- [Dockge](https://github.com/louislam/dockge)（MIT）：Docker Compose 堆栈管理和实时日志交互。
- [CasaOS](https://github.com/IceWhaleTech/CasaOS)（Apache-2.0）：家庭服务器 Dashboard、应用导航和低门槛交互。
- [Cockpit](https://github.com/cockpit-project/cockpit)（包含 LGPL-2.1-or-later、GPL-3.0-or-later、BSD-3-Clause、MIT、CC-BY-SA-3.0 等）：存储状态抽象和服务器管理交互。
- [BigBear Dockge](https://github.com/bigbeartechworld/big-bear-dockge) 与 [BigBear CasaOS](https://github.com/bigbeartechworld/big-bear-casaos)：应用模板、Compose 配置和元数据组织方式。
- [copyparty](https://github.com/9001/copyparty)（MIT）：轻量文件服务、多协议共享和文件操作思路。
- [SFTPGo](https://github.com/drakkan/sftpgo)（AGPL-3.0-only，并带附加条款）：文件服务能力和存储后端抽象思路。
