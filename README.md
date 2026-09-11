# MacNAS

MacNAS 是面向 macOS 的家庭 NAS Web 控制台：Go 后端通过浏览器提供管理界面，Lima 提供 Linux 虚拟机，虚拟机内运行 Docker、文件服务、SMB 和终端。

正式发行方式是“预编译二进制压缩包 + `install.sh`”，不提供 DMG 或桌面 App。发行包不包含开发机用户、Docker 容器、Docker 镜像、卷、Lima 实例或任何 NAS 数据。

## 从源码构建 macOS 发行包

在 macOS 上执行：

```bash
make release-mac
```

默认按当前机器架构生成压缩包：

```text
dist/MacNAS_<版本>_macos_aarch64.tar.gz   # Apple Silicon
dist/MacNAS_<版本>_macos_x86_64.tar.gz    # Intel
```

构建脚本会先构建 React 前端，再将 `web/dist` 嵌入 Go 二进制；最终用户不需要 Node.js。维护者也可以使用 `MACNAS_GOARCH=amd64` 或 `MACNAS_GOARCH=arm64` 交叉构建另一种 macOS 架构。

## 用户安装和启动

解压匹配架构的发行包：

```bash
cd MacNAS_*
./install.sh
export PATH="$HOME/.local/bin:$PATH"
macnas --lan
```

安装器会检查 Lima。若已安装 Homebrew，会在确认后执行 `brew install lima`；若没有 Homebrew，会显示官方安装命令并停止，不会静默执行远程安装脚本。服务以前台方式运行，终端会显示 Lima 初始化、错误和 Web 地址，按 `Ctrl+C` 停止。

首次初始化请在运行 MacNAS 的 Mac 本机浏览器打开：

```text
http://127.0.0.1:19808
```

首次管理员账号固定为 `admin`，初始密码为 `admin123`。首次初始化只允许本机完成；完成后，局域网设备访问终端打印的 `http://<Mac局域网IP>:19808` 即可登录。`macnas --lan` 监听 `0.0.0.0`，若不需要局域网访问，可改用 `macnas --host 127.0.0.1`。

更多安装、校验、目录直通和卸载说明见 [`docs/macos-cli-install.md`](/Users/luluen/ai-project/mac-nas/docs/macos-cli-install.md)。

## 完整删除 MacNAS

发行包自带卸载脚本。仅移除程序并保留数据：

```bash
./uninstall.sh
```

恢复新用户状态，删除 MacNAS 专属 Lima 实例、`macnas-data` 管理盘、配置和数据镜像：

```bash
./uninstall.sh --purge
```

同时卸载 Homebrew 安装的 Lima：

```bash
./uninstall.sh --purge --uninstall-lima
```

破坏性清理必须输入 `DELETE`。脚本不会删除其他 Lima 实例、Homebrew、宿主机无关 Docker 数据或整个 `~/MacNAS` 目录。

## 开发命令

```bash
make build              # 构建前端并编译 bin/macnas
make dev-backend        # 仅本机访问的开发服务
make dev-backend-lan    # 局域网可访问的开发服务
make test               # 后端单元测试
```

纯 Web 版无法取得 macOS 本机的绝对路径，因此目录直通需要在 Web 页面填写“运行 MacNAS 的 Mac”上的路径。直通目录中的文件仍留在原位置，不会复制进 NAS 数据镜像。
