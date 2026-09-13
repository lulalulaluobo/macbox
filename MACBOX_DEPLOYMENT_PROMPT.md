# MacBox 部署提示词

将下面内容完整发送给具有 macOS 本机终端权限的 Agent。此流程只适用于在运行 MacBox 的 Mac 本机部署，不适用于 VM 内终端。

```text
请按以下要求部署 MacBox：

1. 先只读检查：
   - macOS 版本
   - CPU 架构：执行 uname -m
   - 网络连接
   - Homebrew
   - Lima
   - 19808 端口是否已有服务监听
   - 以下路径是否已存在：
     ~/.local/share/macbox
     ~/.local/bin/macbox
     ~/Applications/MacBoxMemu.app
     ~/.macbox

2. 根据 CPU 架构选择发行包：
   - arm64：选择 macos_aarch64 发行包
   - x86_64：选择 macos_x86_64 发行包

3. 从以下地址获取最新稳定 Release：
   https://github.com/lulalulaluobo/macbox/releases/latest

   必须确认 Release 不是 draft 或 prerelease，并下载对应架构的发行包及 Release 提供的 SHA-256 校验文件。

4. 将下载、解压和校验文件放在：
   ~/macbox/临时版本目录/

   使用 Release 提供的 SHA-256 校验发行包。校验失败时立即停止，不得继续解压或安装。

5. Lima 处理：
   - 如果 Lima 已安装，直接复用，不要重复安装。
   - 如果 Lima 未安装，先说明需要执行：brew install lima
   - 必须等待用户确认后才能安装 Lima。
   - 不得安装 Docker Desktop。
   - 不得静默执行 curl | sh、远程安装脚本或其他未经确认的远程脚本。

6. 安装前检查目标路径：
   - 如果目标路径不存在，可以运行发行包中的本地 install.sh。
   - 如果目标路径已存在任何文件、配置、虚拟机、容器、镜像、卷或用户数据，不得删除、覆盖或强制运行会覆盖它们的安装流程。
   - 遇到系统授权、密码输入或任何可能破坏数据的操作，先暂停并向用户确认。

7. 安装位置必须保持为：
   - ~/.local/share/macbox
   - ~/.local/bin/macbox
   - ~/Applications/MacBoxMemu.app
   - ~/.macbox

8. 安装完成后只启动：
   ~/Applications/MacBoxMemu.app

   如果菜单栏出现 MacBox 图标，提示用户点击菜单栏中的“启动后端服务”。不要自动代替用户点击首次初始化，不要代替用户创建管理员用户名或密码，并等待用户在本机网页完成首次初始化。

9. 只有在 MacBoxMemu.app 无法启动、菜单栏助手不可用或菜单栏图标无法使用时，才使用备用命令：
   ~/.local/bin/macbox --host 0.0.0.0 --port 19808

   备用端口必须使用 19808，不得使用其他端口。

10. 启动后端前检查 19808 端口：
    - 如果已有 MacBox 服务监听，检查并复用它。
    - 如果是其他无关进程占用，不得终止该进程，报告冲突并停止。
    - 不得重复启动 MacBox 服务。

11. 使用 curl 检查：
    curl http://127.0.0.1:19808/api/auth/status

    记录 HTTP 状态和返回内容。如果返回 setupRequired=true，说明等待用户在本机网页完成首次初始化，不得代替用户设置管理员密码。

12. 最后返回完整结果：
    - 实际安装版本
    - CPU 架构
    - 发行包名称
    - SHA-256 校验结果
    - 安装目录
    - 菜单栏应用路径及运行状态
    - Lima 版本及虚拟机状态
    - 本机地址：http://127.0.0.1:19808
    - 局域网地址：http://局域网IP:19808
    - curl 检查结果
    - 是否需要用户继续完成首次初始化
    - 失败原因；如果没有失败，明确写“无”。
```
