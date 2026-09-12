# MacNAS macOS Web 服务发行版

MacNAS 正式发行版是 macOS Web 服务压缩包，不提供 DMG。发行包根目录提供可选的原生 `MacNASMenu.app` 菜单栏助手、备用 `MacNAS.command` 控制器，以及 `install.sh`/`uninstall.sh` 命令。MacNAS 作为 Go Web 服务运行，浏览器负责全部管理操作；Lima 提供 Linux 虚拟机，Docker、Samba、文件管理和终端均由 Web 控制台管理。

## 首选：本地 Agent 一句话部署

如果目标 Mac 已安装 Codex CLI、WorkBuddy 或其他具有本地终端权限的 Agent，直接发送：

```text
请在当前这台 macOS 上部署 MacNAS：访问 https://github.com/lulalulaluobo/macnas/releases/latest，自动识别 Apple Silicon 或 Intel，下载并校验对应压缩包，将下载、解压和校验文件放在用户目录 ~/macnas，优先启动发行包中的 MacNASMenu.app，检测并在需要时通过 Homebrew 安装或复用 Lima，完成安装并启动 Web 服务，最后打开本机 Web 页面并返回局域网访问地址；不要使用开发机绝对路径，不要删除用户数据，遇到系统授权或破坏性操作时先向我确认。
```

## 安装

下载与你的 Mac 架构匹配的 `MacNAS_*_macos_aarch64.tar.gz`（Apple Silicon）或 `MacNAS_*_macos_x86_64.tar.gz`（Intel），解压后双击根目录的 `MacNASMenu.app`，再从顶部栏选择“启动后端服务”即可。首次运行未签名开源 App 时，如果 macOS 阻止打开，请在 Finder 中右键选择“打开”。

首次双击会在发现尚未安装时询问是否安装程序，并沿用安装器的 Lima 检查流程。也可以从终端执行：

```bash
cd MacNAS_*
./install.sh
```

安装器会：

1. 检查 macOS 和 CPU 架构。
2. 检查 Lima；已安装 Homebrew 时，经确认后执行 `brew install lima`。没有 Homebrew 时只显示官方安装命令，不会静默执行远程脚本。
3. 安装预编译后端到 `~/.local/share/macnas`，并在 `~/.local/bin/macnas` 建立命令入口。
4. 不复制任何 Docker 容器、镜像、卷、用户目录或开发机配置。

如果 `macnas` 不在当前终端的 PATH 中，请先执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 启动 Web 服务

推荐以前台方式启动，日志会直接显示在终端，便于观察 Lima 初始化和失败原因：

```bash
macnas --lan
```

默认监听 `0.0.0.0:19808`。终端会打印本机地址和局域网地址，例如：

```text
本地访问地址：http://127.0.0.1:19808
局域网访问：http://192.168.1.20:19808
```

然后从顶部栏 MacNAS 菜单选择“启动后端服务”；助手会后台启动服务并自动打开本机浏览器。首次管理员初始化只允许在运行 MacNAS 的 Mac 本机完成，登录页会要求现场设置管理员用户名和至少 8 个字符的强密码；初始化完成后，局域网其他设备即可登录。

服务默认只信任 `localhost` 和 IP 地址形式的 Host。若前面有反向代理并使用自定义域名，请显式设置 `MACNAS_ALLOWED_HOSTS`（逗号分隔的主机名），并配合 HTTPS 或 VPN 使用。

## Docker 服务的局域网访问

应用商城和 Docker Compose 页面部署服务时，在 Compose 的 `ports` 中声明宿主机端口即可。MacNAS 会自动登记这些端口并在发现新端口时重启 Lima，使它们绑定到 `0.0.0.0`，无需手动编辑 Lima 配置或重启服务。例如：

```yaml
services:
  app:
    image: example/app:latest
    ports:
      - "8088:80"
```

部署日志会显示端口登记和虚拟机重启过程。重启完成后，局域网设备访问 `http://<Mac局域网IP>:8088`。停止或删除项目不会自动移除端口白名单，因为同一个端口可能被其他项目复用；没有容器监听时该转发不会产生服务响应。

## 使用 AI 维护 Docker 容器

Web 终端顶部提供三个 AI CLI 快捷按钮：`Codex`、`Claude`、`Anti Gravity`。它们分别输入以下命令并直接启动交互会话：

```text
codex --dangerously-bypass-approvals-and-sandbox
claude --dangerously-skip-permissions
agy --dangerously-skip-permissions
```

请先在 Lima 虚拟机中安装并登录这些 CLI。上述参数会跳过安全审批，AI 可以直接执行当前终端用户允许的命令；MacNAS 不替用户审核 AI 生成的操作。

### 映射本机 AI CLI Skill

在 Web 控制台「设置 → 终端 → AI CLI Skill 目录」中选择 MacNAS 运行主机上的 Skill 目录。系统会自动扫描以下常见位置：

- `~/.agents/skills`（推荐，Agent CLI 通用目录）
- `~/.codex/skills`
- `~/.claude/skills`

确认后，目录会通过 Lima 以只读方式映射到 `/home/macnasctl/.agents/skills` 和 `/root/.agents/skills`。这样 Web 终端中以普通用户或 root 启动的 AI CLI 都能发现这些 Skill。纯 Web 场景下浏览器的文件夹选择器只代表当前手机/电脑，不能选择运行 MacNAS 的主机目录，因此界面使用 MacNAS 本机扫描结果和路径输入；已有运行中的 VM 保存后请重启一次。

Docker 容器管理页新增 `AI` 按钮：它会获取对应容器最近 200 行日志，自动切换到 Web 终端并放入输入框。日志不会自动发送，用户可以先启动任一 AI CLI，再检查内容后点击发送；超长日志会保留末尾最多 60,000 个字符。

也可以安装后立即启动：

```bash
./install.sh --start
```

## 夸克云盘和下载任务

打开「文件 → 更多 → 挂载云盘」，选择夸克云盘后使用夸克 App 扫码授权。MacNAS 不要求粘贴 Cookie，也不保存手机号、密码或短信验证码；会话只保存在服务端和权限为 `0600` 的配置中。挂载完成后，云盘会作为文件页中的独立磁盘入口出现。

云端支持浏览、新建文件夹、重命名、删除，以及下载文件或文件夹到 NAS 数据目录。默认目标是 `/data/downloads`，下载会进入后台任务列表，显示文件进度、速度和当前文件；刷新页面后任务仍可查看。当前版本使用手机扫码确认，手机号和短信登录仍由夸克官方页面负责。

指定端口或监听地址：

```bash
macnas --host 0.0.0.0 --port 19808
macnas --host 127.0.0.1 --port 19808
```

按 `Ctrl+C` 停止服务。需要后台运行时，建议由用户自行选择 `tmux`、`nohup` 或 macOS LaunchAgent；安装器不会把启动失败隐藏在后台。

菜单栏助手、LaunchAgent 和备用控制器统一将服务日志写入 `~/.macnas/macnas.log`。从顶部栏选择“停止后端服务”或双击 `MacNAS.command` 并选择停止即可，不需要查找进程号。

## 数据和磁盘说明

发行包本身不包含数据。首次初始化后，Lima 实例、管理数据盘、配置和数据镜像才会在当前用户目录产生。Mac 本机目录直通仍需填写运行 MacNAS 的 Mac 本机绝对路径；纯浏览器出于安全限制不能提供 macOS 原生文件夹选择器。直通目录中的文件仍保留在 Mac 原位置，不会复制进 NAS 数据镜像。

## 卸载和恢复初始状态

仅移除程序，保留配置、虚拟机和数据：

```bash
./uninstall.sh
```

完全删除 MacNAS 专属资源（会删除该 Lima 实例内的 Docker 容器、镜像和卷）：

```bash
./uninstall.sh --purge
```

完全删除并卸载 Homebrew 安装的 Lima：

```bash
./uninstall.sh --purge --uninstall-lima
```

菜单栏助手的“彻底卸载”会先进行二次确认，然后只删除 MacNAS 实例、管理盘、数据镜像、Docker 资源和配置；菜单中的“卸载程序”则保留这些运行数据。

破坏性命令必须手动输入 `DELETE`。它不会删除其他 Lima 实例、Homebrew、宿主机无关 Docker 数据或整个 `~/MacNAS` 目录，只处理 MacNAS 固定资源。

## 开源许可

MacNAS 代码采用 [Apache License 2.0](LICENSE)。

## 校验发行包

解压后可校验包内脚本、二进制和 VM 模板：

```bash
shasum -a 256 -c checksums.txt
```

发行包外还有同名 `.sha256` 文件，用于校验整个压缩包。
