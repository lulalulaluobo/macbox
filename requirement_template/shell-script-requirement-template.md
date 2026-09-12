# MacNAS macOS 双击控制器需求

## 1. 基础信息

- 脚本名称（显示名）: MacNAS 控制中心
- 输出文件名: `MacNAS.command`
- 版本号: 0.1.0
- 简短描述: 通过 Finder 双击打开原生 macOS 菜单，管理 MacNAS Web 服务的启动、停止和彻底清理。
- 命令别名: `start`、`stop`、`uninstall`

## 2. 运行环境

- 目标系统: macOS
- 必须 root 运行: 否
- 是否支持无参数菜单模式: 是
- 默认语言风格: 中文

## 3. 功能清单

1. 双击后显示原生 macOS 选择菜单。
2. 启动 Web 服务并默认监听 `0.0.0.0:19808`，必要时先执行安装器和 Lima 检查。
3. 停止由控制器启动的 Web 服务，并停止已有 MacNAS LaunchAgent。
4. 彻底清理 MacNAS Lima 实例、管理盘、数据镜像、Docker 资源和配置；可选卸载 Homebrew Lima。

## 4. 命令接口设计

- `MacNAS.command start`: 安装（如尚未安装）并后台启动 Web 服务。
- `MacNAS.command stop`: 停止 Web 服务。
- `MacNAS.command uninstall`: 二次确认后执行 `uninstall.sh --purge`。
- `MacNAS.command uninstall --uninstall-lima`: 同时卸载 Homebrew Lima。

## 5. 菜单设计

- 启动 MacNAS
- 停止 MacNAS
- 彻底卸载（实例、镜像和数据）
- 退出

## 6. 依赖与安装策略

- 仅面向 macOS；依赖 `bash`、`osascript`、`launchctl`、`curl` 和发行包中的安装/卸载脚本。
- Lima 缺失时沿用 `install.sh` 的 Homebrew 检查和交互式安装策略。

## 7. 安全与风险控制

- 彻底卸载是高风险操作，必须经过原生对话框和卸载脚本的 `DELETE` 二次确认。
- 只删除 MacNAS 固定资源，不删除其他 Lima 实例、Homebrew 无关资源或宿主机无关 Docker 数据。
- PID 文件只接受匹配 MacNAS 安装路径的进程，避免误杀其他进程。

## 8. 日志与可观测性

- Web 服务日志: `~/.macnas/macnas.command.log`
- 不上报外部 telemetry。

## 9. 输出与交付要求

- 发行包根目录包含可执行 `MacNAS.command`。
- 发行包校验和包含该文件。
- 同步更新安装说明和卸载说明。
- 验证 Bash 语法、UTF-8 无 BOM、LF 换行和发行包构建。

## 11. 备注

- 双击启动使用后台进程，关闭 Finder 或 Terminal 窗口不会停止 MacNAS；再次双击菜单中的“停止 MacNAS”即可停止。
- 服务默认按局域网模式启动；如需仅本机访问，可设置 `MACNAS_HOST=127.0.0.1` 后从终端调用 `MacNAS.command start`。
