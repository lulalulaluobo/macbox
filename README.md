# MacNAS

MacNAS 是面向 macOS 的家庭 NAS Web 控制台：Go 后端通过浏览器提供管理界面，Lima 提供 Linux 虚拟机，虚拟机内运行 Docker、文件服务、SMB 和终端。

正式发行方式是“预编译二进制压缩包 + `MacNASMenu.app`/`install.sh`”，不提供 DMG。发行包不包含开发机用户、Docker 容器、Docker 镜像、卷、Lima 实例或任何 NAS 数据。`MacNASMenu.app` 是可选的原生菜单栏助手，Web 控制台仍是主界面。

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

仅构建顶部菜单栏助手：

```bash
make build-mac-menu
```

## 用户安装和启动

解压匹配架构的发行包后，先双击根目录中的 `MacNASMenu.app`。它会常驻 macOS 顶部菜单栏，提供打开 Web、启动/停止后端、启动/停止 Lima、查看日志以及分级卸载。首次运行未签名开源 App 时，如果 macOS 阻止打开，请在 Finder 中右键选择“打开”。

也可以使用命令行安装：

```bash
cd MacNAS_*
./install.sh
export PATH="$HOME/.local/bin:$PATH"
macnas --lan
```

安装完成后可以从顶部栏 MacNAS 菜单启动服务。`MacNAS.command` 仍然保留，适合不使用菜单栏助手时的备用控制。

安装器会检查 Lima。若已安装 Homebrew，会在确认后执行 `brew install lima`；若没有 Homebrew，会显示官方安装命令并停止，不会静默执行远程安装脚本。服务以前台方式运行，终端会显示 Lima 初始化、错误和 Web 地址，按 `Ctrl+C` 停止。

首次初始化请在运行 MacNAS 的 Mac 本机浏览器打开：

```text
http://127.0.0.1:19808
```

首次管理员账号固定为 `admin`，初始密码为 `admin123`。首次初始化只允许本机完成；完成后，局域网设备访问终端打印的 `http://<Mac局域网IP>:19808` 即可登录。`macnas --lan` 监听 `0.0.0.0`，若不需要局域网访问，可改用 `macnas --host 127.0.0.1`。

### Docker 项目的局域网访问

应用商城和 Docker Compose 页面部署项目时，MacNAS 会自动读取 Compose 中的宿主机 `ports` 映射，并将端口加入 Lima 转发白名单。发现新端口后会自动短暂重启虚拟机，使端口立即绑定到 Mac 的局域网地址；已登记的端口不会重复重启。之后可通过 `http://<Mac局域网IP>:<端口>` 访问对应服务。

因此新项目应使用标准 Compose 端口映射，例如：

```yaml
services:
  app:
    image: example/app:latest
    ports:
      - "8088:80"
```

端口必须是宿主机可用的 TCP 端口；如果端口冲突或虚拟机重启失败，部署日志会明确提示，容器不会被静默认为“局域网已可访问”。

更多安装、校验、目录直通和卸载说明见 [`docs/macos-cli-install.md`](docs/macos-cli-install.md)。

### AI 终端维护容器

Web 终端顶部提供 `Codex`、`Claude` 和 `Anti Gravity` 三个快捷入口，分别执行对应 CLI 的高权限模式：

```text
codex --dangerously-bypass-approvals-and-sandbox
claude --dangerously-skip-permissions
agy --dangerously-skip-permissions
```

这三个 CLI 必须预先安装在 Lima 虚拟机中，并完成各自登录。按钮会跳过对应工具的安全审批，拥有当前终端用户的权限，只建议管理员在可信环境中使用。Docker 容器管理页的 `AI` 按钮会读取最近 200 行容器日志，切换到 Web 终端并填入输入框；不会自动发送，选择 AI 后仍需由用户点击发送。

在「设置 → 终端」中可以配置 AI CLI Skill 目录。MacNAS 会在运行服务的 Mac 本机扫描 `~/.agents/skills`（推荐）、`~/.codex/skills` 和 `~/.claude/skills`，管理员确认后以只读方式挂载到 VM 的 `/home/macnasctl/.agents/skills` 与 `/root/.agents/skills`。纯 Web 访问时不要使用浏览器目录选择器代替本机路径：手机或浏览器选择到的是当前访问设备，而不是运行 MacNAS 的 Mac。已有运行中的 VM 保存映射后需要重启一次；尚未创建 VM 的安装会在首次启动时自动应用。

## 完整删除 MacNAS

发行包根目录的 `MacNASMenu.app` 菜单包含“卸载程序（保留实例和数据）”与“彻底卸载（实例、镜像和配置）”。彻底卸载会先进行原生对话框确认，再调用安全卸载流程；不会删除其他 Lima 实例、宿主机无关 Docker 数据或整个 `~/MacNAS` 目录。

也可以直接使用发行包自带卸载脚本。仅移除程序并保留数据：

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
