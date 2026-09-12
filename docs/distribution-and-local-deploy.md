# MacNAS 分发与本地部署指南

本文说明新用户如何通过本地 Agent、GitHub Release 或源码完成 MacNAS 部署，以及怎样把安装阻力降到最低。

## 结论：本地 Agent 优先，GitHub Release 作为标准兜底

| 用户类型 | 获取方式 | 用户需要准备 | 推荐入口 |
| --- | --- | --- | --- |
| 普通家庭用户 | 本地 Agent 调用 GitHub Release | 已安装 Codex CLI、WorkBuddy 或其他有本机终端权限的 Agent | 一句话提示词部署 |
| 手动安装用户 | GitHub Release 预编译压缩包 | macOS；Lima/Homebrew 按首次初始化提示处理 | 双击 `MacNASMenu.app` |
| 开发者/贡献者 | GitHub 源码 | Go、Node.js/npm、Xcode Command Line Tools | `make release-mac` |
| 内部测试 | 当前工作树 | 完整开发环境 | `make build` 或 `make dev-backend-lan` |

本地 Agent 是普通用户的首选入口：它可以在用户自己的 Mac 上完成架构识别、Release 下载、SHA-256 校验、Lima 检查和启动，不要求用户理解目录、命令或运行时依赖。Release 是没有本地 Agent 时的标准兜底，用户不需要 Go、Node.js、npm，也不需要自己编译前端和后端。源码部署应该定位为开发和贡献流程。

## 本地 Agent 一句话部署

将下面的提示词发送给运行在目标 Mac 上、并且具有本地终端权限的 Codex CLI、WorkBuddy 或其他 Agent：

```text
请在当前这台 macOS 上部署 MacNAS：自动识别 Apple Silicon 或 Intel，从 MacNAS GitHub 的最新 Release 下载并校验对应压缩包，优先启动发行包中的 MacNASMenu.app，检测并在需要时通过 Homebrew 安装或复用 Lima，完成安装并启动 Web 服务，最后打开本机 Web 页面并返回局域网访问地址；不要使用开发机绝对路径，不要删除用户数据，遇到系统授权或破坏性操作时先向我确认。
```

本地 Agent 必须实际运行在安装 MacNAS 的那台 Mac 上。手机端聊天或没有本机终端权限的云端 Agent 不能代替部署。Agent 完成后应返回实际安装目录、服务地址、Lima 状态和失败日志。

## Release 用户安装（推荐优先双击 `MacNASMenu.app`）

### 1. 下载并校验正确架构

- Apple Silicon（M1/M2/M3/M4）：下载 `MacNAS_*_macos_aarch64.tar.gz`。
- Intel Mac：下载 `MacNAS_*_macos_x86_64.tar.gz`。

不要混用架构；安装器会在开始时检查并拒绝不匹配的二进制。

建议在首次运行前校验发行包，确认文件没有损坏或被替换：

```bash
shasum -a 256 -c checksums.txt
```

校验不通过时不要启动 App，应该重新下载对应 Release。

### 2. 推荐方式：双击 `MacNASMenu.app`

解压后进入完整发行包根目录，直接双击 `MacNASMenu.app`。从 macOS 顶部菜单栏选择：

1. 启动后端服务；
2. 打开网页端；
3. 首次进入时完成初始化。

这条路径直接使用发行包中的预编译后端，不要求普通用户先安装 Go、Node.js 或执行构建命令。菜单栏助手是 Web 控制台的启动、停止、状态和日志入口，不承担 Web 页面本身的功能。

#### 首次打开未签名或未公证的开源 App

MacNASMenu 是开源分发的未签名/未公证 App 时，macOS 可能首次阻止打开。按以下顺序处理：

1. 在 Finder 中对 `MacNASMenu.app` 右键，选择“打开”，再确认一次“打开”；
2. 如果仍被阻止，先尝试打开一次，然后进入“系统设置 → 隐私与安全性”，在安全性提示区域点击“仍要打开”，再确认打开 App。

这是针对单个 App 的放行。执行前应先完成上面的 SHA-256 校验，并确认发行包来自可信的 GitHub Release。Apple 也提醒，绕过未识别开发者保护可能带来安全风险，详见 [Apple：安全地打开 Mac App](https://support.apple.com/en-gb/102445) 和 [Apple：打开来自未知开发者的 App](https://support.apple.com/en-ca/guide/mac-help/mh40616/mac)。

如果你明确确认 App 来源可信，也可以只对这个 App 移除下载隔离标记，然后重新打开：

```bash
# 在发行包根目录执行；路径含空格时仍然安全
xattr -dr com.apple.quarantine "./MacNASMenu.app"
open "./MacNASMenu.app"
```

上面的命令只处理指定的 `MacNASMenu.app`，不要使用会全局关闭 Gatekeeper 的 `sudo spctl --master-disable`。如果 App 不在当前目录，把 `./MacNASMenu.app` 替换为它的实际完整路径。

### 3. 命令行备用方式

在下载文件所在目录执行：

```bash
tar -xzf MacNAS_*_macos_*.tar.gz
cd MacNAS_*_macos_*
./install.sh --start
```

`--start` 会以前台方式启动 Web 服务，终端会持续显示日志；按 `Ctrl+C` 停止。默认服务地址：

```text
本机：http://127.0.0.1:19808
局域网：http://<Mac局域网IP>:19808
```

首次初始化必须在运行 MacNAS 的 Mac 本机完成。初始化完成后，手机或其他局域网设备访问局域网地址即可。

API 默认只接受 `localhost` 和 IP 地址形式的 Host，以阻断 DNS Rebinding。若使用反向代理自定义域名，启动前显式设置允许的主机名，例如：

```bash
export MACNAS_ALLOWED_HOSTS=nas.example.com
macnas --lan
```

这只是 Host 校验配置，不会为服务启用 HTTPS；当前发行版仍定位为可信局域网使用，远程访问应放在 HTTPS 反向代理或 VPN 后面。

### 4. Lima 依赖处理

- 已安装 Lima：安装器直接复用。
- 已安装 Homebrew、但没有 Lima：交互式安装器会询问后执行 `brew install lima`。
- 没有 Homebrew：安装器会停止并显示 Homebrew 官方安装命令，不会静默执行远程脚本。

也可以先手动执行：

```bash
brew install lima
```

然后再次运行 `./install.sh --start`。

## 源码本地部署

源码方式适合修改代码、调试或提交贡献。源码构建会把 React 前端构建结果嵌入 Go 后端，最终发行包仍然是一个不依赖 Node.js 的压缩包。

### 1. 获取源码和开发依赖

请先在 MacNAS GitHub 仓库页面复制实际的 HTTPS 地址，再执行：

```bash
git clone <MacNAS GitHub 仓库 HTTPS 地址>
cd mac-nas
```

需要准备：

- macOS 13 或更高版本；
- 与仓库 `go.mod` 匹配的 Go；
- Node.js 和 npm；
- Xcode Command Line Tools（构建 `MacNASMenu.app` 需要 `swiftc` 与 `lipo`）；
- Lima；
- 运行首次初始化所需的磁盘权限。

### 2. 构建发行包并本地安装

```bash
make release-mac
ls dist/MacNAS_*_macos_*.tar.gz
```

构建完成后，使用与普通用户相同的安装流程：

```bash
tar -xzf dist/MacNAS_*_macos_*.tar.gz -C /tmp
cd /tmp/MacNAS_*_macos_*
./install.sh --start
```

`make release-mac` 会完成以下工作：

1. 构建 Web 前端；
2. 编译当前 Mac 架构的 Go 后端；
3. 复制 VM 模板、安装器、卸载器和备用控制器；
4. 编译 Universal `MacNASMenu.app`；
5. 生成 `checksums.txt` 和压缩包 SHA-256 文件。

只编译开发用本机后端：

```bash
make build
./bin/macnas --host 0.0.0.0 --port 19808
```

只启动开发前端和后端的方式见项目开发文档；普通用户不应执行源码开发命令。

## 分发时的设计原则

### 不把开发机环境带给用户

- 不写入开发机用户名、绝对路径、私有配置或测试数据。
- 不把 Docker 容器、镜像、卷、Lima 实例和 NAS 数据放进发行包。
- 所有运行目录使用用户安装目录和运行时配置动态计算。
- 本机目录直通必须由用户在运行 MacNAS 的 Mac 上配置，不能复用开发机路径。

### 让安装失败可修复

- 安装器在开始阶段检查操作系统、CPU 架构、发行包完整性和校验值。
- 缺少 Lima 时显示明确的安装方式。
- Web 首次初始化显示环境诊断、VM 状态、数据盘、SSH、Docker 和直通探针。
- 菜单栏助手显示 Web 服务和资源状态，并提供日志入口。
- 启动失败保留后台任务阶段和错误信息，不显示无限加载。

### 推荐的 GitHub Release 内容

每个版本至少发布：

```text
MacNAS_<version>_macos_aarch64.tar.gz
MacNAS_<version>_macos_aarch64.tar.gz.sha256
MacNAS_<version>_macos_x86_64.tar.gz
MacNAS_<version>_macos_x86_64.tar.gz.sha256
```

Release 描述中只需要保留：支持的 macOS 架构、安装命令、首次初始化地址、局域网访问说明、卸载命令和已知限制。详细技术内容放在仓库文档中，避免用户在发布页面对过多开发信息。

## 卸载和恢复初始状态

仅卸载程序、保留实例和数据：

```bash
./uninstall.sh
```

删除 MacNAS 专属实例、镜像、Docker 容器/镜像/卷、配置和数据：

```bash
./uninstall.sh --purge
```

连同 Homebrew 安装的 Lima 一起移除：

```bash
./uninstall.sh --purge --uninstall-lima
```

破坏性清理需要输入 `DELETE` 确认，且不会删除其他 Lima 实例或宿主机无关数据。
