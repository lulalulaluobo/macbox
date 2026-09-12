# MacNAS 分发与本地部署指南

本文说明新用户从 GitHub 获取 MacNAS 后，应该选择 Release 还是源码，以及怎样把安装阻力降到最低。

## 结论：普通用户优先使用 GitHub Release

| 用户类型 | 获取方式 | 用户需要准备 | 推荐入口 |
| --- | --- | --- | --- |
| 普通家庭用户 | GitHub Release 预编译压缩包 | macOS、Homebrew/Lima | `install.sh --start` 或 `MacNASMenu.app` |
| 开发者/贡献者 | GitHub 源码 | Go、Node.js/npm、Xcode Command Line Tools | `make release-mac` |
| 内部测试 | 当前工作树 | 完整开发环境 | `make build` 或 `make dev-backend-lan` |

Release 是降低分发阻力的核心：用户不需要 Go、Node.js、npm，也不需要自己编译前端和后端。源码部署应该定位为开发和贡献流程，不应作为普通用户的默认路径。

## Release 用户安装

### 1. 下载正确架构

- Apple Silicon（M1/M2/M3/M4）：下载 `MacNAS_*_macos_aarch64.tar.gz`。
- Intel Mac：下载 `MacNAS_*_macos_x86_64.tar.gz`。

不要混用架构；安装器会在开始时检查并拒绝不匹配的二进制。

### 2. 一条命令安装并启动

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

### 3. 无需命令行的方式

在完整发行包根目录双击 `MacNASMenu.app`，从顶部菜单选择：

1. 启动后端服务；
2. 打开网页端；
3. 首次进入时完成初始化。

菜单栏助手是可选控制器，不承担 Web 页面功能。MacOS 首次阻止未签名开源 App 时，在 Finder 中右键选择“打开”。

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

```bash
git clone https://github.com/luluen/mac-nas.git
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

