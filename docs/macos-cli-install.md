# MacNAS macOS Web 服务发行版

MacNAS 正式发行版是 macOS 命令行安装包，不提供 DMG 或桌面 App。安装后，MacNAS 作为一个前台 Go Web 服务运行，浏览器负责全部管理操作；Lima 提供 Linux 虚拟机，Docker、Samba、文件管理和终端均由 Web 控制台管理。

## 安装

下载与你的 Mac 架构匹配的 `MacNAS_*_macos_aarch64.tar.gz`（Apple Silicon）或 `MacNAS_*_macos_x86_64.tar.gz`（Intel），解压后执行：

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

然后在本机浏览器打开 `http://127.0.0.1:19808`。首次管理员初始化只允许在运行 MacNAS 的 Mac 本机完成，固定账号是 `admin`，初始密码是 `admin123`；初始化完成后，局域网其他设备即可登录。

也可以安装后立即启动：

```bash
./install.sh --start
```

指定端口或监听地址：

```bash
macnas --host 0.0.0.0 --port 19808
macnas --host 127.0.0.1 --port 19808
```

按 `Ctrl+C` 停止服务。需要后台运行时，建议由用户自行选择 `tmux`、`nohup` 或 macOS LaunchAgent；安装器不会把启动失败隐藏在后台。

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

破坏性命令必须手动输入 `DELETE`。它不会删除其他 Lima 实例、Homebrew、宿主机无关 Docker 数据或整个 `~/MacNAS` 目录，只处理 MacNAS 固定资源。

## 校验发行包

解压后可校验包内脚本、二进制和 VM 模板：

```bash
shasum -a 256 -c checksums.txt
```

发行包外还有同名 `.sha256` 文件，用于校验整个压缩包。
