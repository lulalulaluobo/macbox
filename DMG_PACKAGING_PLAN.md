# MacBox DMG 打包与安装方案

## 目标

将现有的“预编译压缩包 + 安装脚本”发行方式扩展为普通用户可理解的 macOS DMG：用户下载与 CPU 架构匹配的 DMG，将 `MacBoxMemu.app` 拖入“应用程序”，首次启动后由应用完成环境检查和用户级安装，并在本机完成管理员初始化后允许局域网设备访问。

当前没有 Apple Developer ID，因此第一版使用 ad-hoc 签名并提供 SHA-256。安装说明必须明确 Gatekeeper 的安全确认方式，不自动移除隔离属性，也不关闭 Gatekeeper。构建流程为以后加入 Developer ID 签名和 Apple 公证预留参数。

## 发行产物

- `MacBox_<version>_macos_aarch64.dmg`
- `MacBox_<version>_macos_aarch64.dmg.sha256`
- `MacBox_<version>_macos_x86_64.dmg`
- `MacBox_<version>_macos_x86_64.dmg.sha256`
- 继续保留同架构的 `tar.gz`，用于命令行部署和故障恢复。

不制作单一 Universal DMG。后端、Lima 虚拟机和镜像都与架构相关，分架构发行更容易校验，也能降低下载体积。

## DMG 内容

```text
MacBox DMG
├── MacBoxMemu.app
├── Applications -> /Applications
└── 安装说明.txt
```

App 中包含完整、可校验的安装载荷：

```text
MacBoxMemu.app/Contents
├── MacOS/MacBoxMemu
├── Helpers/macbox
├── Resources/runtime/templates
├── Resources/runtime/assets
├── Resources/runtime/install.sh
├── Resources/runtime/uninstall.sh
├── Resources/runtime/MacBox.command
└── Info.plist
```

## 安装与升级模型

1. 如果 App 位于只读的 `/Volumes/...`，菜单栏程序提示用户先拖入“应用程序”，不直接在 DMG 中安装。
2. App 位于 `/Applications` 或 `~/Applications` 后，首次启动检查 macOS 版本、CPU 架构、端口、Homebrew、Lima、旧版本与目标目录。
3. 将 App 内载荷原子化安装到现有用户级路径：
   - `~/.local/share/macbox`
   - `~/.local/bin/macbox`
   - `~/.macbox`
4. 升级通过运行载荷指纹识别内容变化；即使版本号不变，也能替换变化的程序和模板，同时保留 `~/.macbox`、Lima 实例、Docker 数据和用户文件。
5. 不要求 root。Finder 将 App 写入系统 `/Applications` 时是否需要认证，由 macOS 自己决定；无管理员权限时可以安装到 `~/Applications`。
6. 没有 Lima 时只在用户确认后打开终端执行 `brew install lima`；没有 Homebrew 时显示官方安装说明，不静默执行远程脚本。

## 局域网访问

1. 首次管理员初始化仍只允许从本机完成。
2. 菜单栏启动、LaunchAgent、配置文件和 Lima 端口转发必须使用同一个监听策略，避免 `127.0.0.1` 与 `0.0.0.0` 不一致。
3. 用户启用局域网访问后，Web 服务监听 `0.0.0.0:19808`，Lima 登记的应用端口和 SMB 端口使用相同的主机绑定地址。
4. 页面和菜单栏同时显示本机地址与当前局域网地址。
5. 如果 19808 被无关进程占用，报告进程和端口冲突，不终止该进程，也不重复启动 MacBox。
6. 防火墙阻止传入连接时，提示用户在“系统设置 → 网络 → 防火墙”中允许 MacBox；程序不静默修改防火墙。
7. 默认只定位于可信局域网，不宣传为公网服务；公网使用需要用户自行配置 HTTPS、VPN 或反向代理。

## macOS 权限策略

- 第一版不启用 App Sandbox，避免阻断 Lima、Homebrew、终端、LaunchAgent 和用户选择目录的正常调用。
- App 与后端启用可选 Hardened Runtime 构建能力；没有 Developer ID 时使用 ad-hoc 签名。
- `Info.plist` 增加 `NSLocalNetworkUsageDescription`，说明 MacBox 需要让局域网设备访问控制台和服务。
- 本机目录通过用户主动选择或明确填写路径接入；不默认索取完全磁盘访问权限。
- 访问受保护目录失败时显示具体诊断和系统设置入口。
- 不自动执行 `xattr`，不全局关闭 Gatekeeper。

## 构建命令

```bash
make dmg
make dmg-aarch64
make dmg-x86-64
```

`make dmg` 在当前 Mac 上依次构建两个架构。每个架构的流程：

1. 构建 React 前端。
2. 编译对应架构的 Go 后端。
3. 构建菜单栏 App 并嵌入运行载荷。
4. 从内向外对后端和 App 进行 ad-hoc 签名。
5. 使用 `hdiutil` 创建压缩 DMG。
6. 使用 `hdiutil verify`、`codesign --verify` 和架构检查验证产物。
7. 生成 DMG SHA-256。

如果以后提供 Developer ID，构建脚本通过环境变量接收签名身份和 `notarytool` Keychain Profile，改用时间戳、Hardened Runtime、公证与 stapler，不改变 DMG 文件结构。

## 验收矩阵

- Apple Silicon 与 Intel 发行包架构正确。
- 从 `/Applications` 和 `~/Applications` 均可首次运行。
- 从 `/Volumes` 直接运行时只提示拖入应用程序。
- 全新安装、已有程序升级、保留数据卸载、彻底卸载行为正确。
- 没有 Homebrew、没有 Lima、已有 Lima三种环境均有明确结果。
- 19808 空闲、被 MacBox 占用、被其他程序占用三种情况均正确。
- 本机 `curl http://127.0.0.1:19808/api/auth/status` 正常。
- 管理员初始化后，iPhone、Android 和另一台电脑可通过局域网 IP 登录。
- Web 控制台、动态 Docker 端口和 SMB 端口均能从局域网访问。
- Shell 脚本为 UTF-8 无 BOM、LF 换行，并通过 `bash -n`。
- DMG 通过 `hdiutil verify`，App 通过 `codesign --verify --strict`。

## 实施阶段

### 第一阶段：可安装测试版 DMG

- 新增 DMG 构建脚本与 Makefile 入口。
- 将完整运行载荷嵌入 App。
- App 支持从内嵌载荷完成用户级安装或升级。
- 补充安装说明、Gatekeeper 提示、局域网用途说明。

### 第二阶段：启动与权限一致性

- 统一菜单栏、LaunchAgent 和 Lima 的监听地址。
- 完善端口冲突、局域网 IP、防火墙和受保护目录诊断。
- 验证旧配置升级不丢失数据。

### 第三阶段：正式签名预留

- 构建脚本支持 Developer ID 参数。
- 有证书后接入 `notarytool` 和 `stapler`。
- 在 GitHub Release 同时发布 DMG、SHA-256 和命令行压缩包。
