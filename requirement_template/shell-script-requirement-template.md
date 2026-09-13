# MacBox macOS DMG 构建脚本需求

## 1. 基础信息

- 脚本名称（显示名）: MacBox DMG Builder
- 输出文件名: `scripts/build-mac-dmg.sh`
- 版本号: 0.1.0
- 简短描述: 将对应 CPU 架构的 MacBox 后端、菜单栏助手和运行资源组装为可拖入“应用程序”的 DMG，并完成签名、验证和 SHA-256 生成。
- 命令别名: `make dmg`、`make dmg-aarch64`、`make dmg-x86-64`

## 2. 运行环境

- 目标系统: macOS
- 必须 root 运行: 否
- 是否支持无参数菜单模式: 否
- 默认语言风格: 中文

## 3. 功能清单

1. 构建 Apple Silicon (`aarch64`) 和 Intel (`x86_64`) 两种 DMG。
2. 将对应架构的后端、模板、资源、安装器、卸载器和备用控制器嵌入 `MacBoxMemu.app`。
3. 没有 Developer ID 时从内向外执行 ad-hoc 签名；预留正式签名身份参数。
4. 使用 `hdiutil` 创建和验证 DMG，并生成独立 SHA-256 文件。
5. DMG 内提供 Applications 快捷方式和简短中文安装说明。
6. 生成运行载荷 `BUILD_ID`，保证同版本覆盖发布时仍能识别并安装内容变化。

## 4. 命令接口设计

- `scripts/build-mac-dmg.sh --arch aarch64`: 构建 Apple Silicon DMG。
- `scripts/build-mac-dmg.sh --arch x86_64`: 构建 Intel DMG。
- `scripts/build-mac-dmg.sh --all`: 依次构建两个架构。
- `scripts/build-mac-dmg.sh --help`: 输出依赖、参数和示例。

## 5. 菜单设计

- 不启用菜单模式。

## 6. 依赖与安装策略

- 仅面向 macOS；依赖 `bash`、Go、npm、Swift 编译器、`lipo`、`codesign`、`hdiutil` 和 `shasum`。
- 构建脚本不自动安装任何依赖；缺少依赖时失败并列出缺失项。
- 运行时 Lima 缺失时继续沿用 `install.sh` 的 Homebrew 检查和交互确认策略。

## 7. 安全与风险控制

- 构建只清理 `dist/` 下对应文件和自身创建的临时目录。
- 临时目录必须使用 `mktemp -d`，并通过 trap 清理。
- 不使用未解析的宽泛路径、`sudo`、`codesign --deep`、自动 `xattr` 或 Gatekeeper 全局关闭命令。
- 覆盖已有 DMG 前只删除经过名称和父目录双重校验的目标文件。
- App 首次安装和升级不得删除 `~/.macbox`、Lima 实例、Docker 数据和用户文件。
- 原子升级失败时必须恢复旧运行目录；恢复也失败时保留旧目录并报告位置，不得由清理钩子删除。
- `~/.local/bin/macbox` 只有在它是指向 MacBox 安装目录的受管链接时才允许替换；其他文件或链接必须保留并报错。
- 目标冲突必须在 Lima 安装、运行目录替换和 App 复制之前完成预检；已有同名 App 仅在 Bundle ID 属于 MacBox 时允许升级。
- DMG 菜单栏 App 发起卸载时，脚本保留正在运行的 App，由 App 使用 macOS 废纸篓接口完成可恢复删除；无权限时提示用户手动移除。

## 8. 日志与可观测性

- 构建过程直接输出阶段、架构、产物路径和 SHA-256；不记录永久构建日志。
- 不上报外部 telemetry。

## 9. 输出与交付要求

- 输出 DMG、DMG SHA-256、验证结果和依赖错误。
- 同步更新 `DMG_PACKAGING_PLAN.md`、README 安装说明和已有压缩包构建描述。
- 验证 Bash 语法、UTF-8 无 BOM、LF 换行、嵌套签名、Mach-O 架构和 DMG 文件系统。
- 保留原有 `tar.gz` 构建流程。

## 10. 示例输入输出

- 示例：`scripts/build-mac-dmg.sh --arch aarch64`
- 预期：生成 `dist/MacBox_0.1.0_macos_aarch64.dmg` 及对应 `.sha256`，并打印签名与 DMG 验证通过。

## 11. 备注

- 当前没有 Apple Developer ID，默认使用 ad-hoc 签名。正式签名和公证只在显式提供签名身份及公证凭据时启用。
- 安装后的服务默认按用户确认的局域网模式运行；首次管理员初始化仍只允许本机完成。
