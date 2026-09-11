# MacNAS macOS Web 服务发行脚本需求

## 1. 基础信息

- 脚本名称（显示名）: MacNAS macOS Web 服务安装器
- 输出文件名: `install.sh`、`uninstall.sh`
- 版本号: 0.1.0
- 简短描述: 安装预编译 MacNAS 后端、检查/安装 Lima，并以命令行方式启动局域网 Web 控制台。
- 命令别名: `macnas`

## 2. 运行环境

- 目标系统: macOS（Apple Silicon 与 Intel 分架构发行包）
- 必须 root 运行: 否；安装到当前用户目录，不使用 sudo
- 是否支持无参数菜单模式: 否；提供 `--help` 和显式子命令/选项
- 默认语言风格: 中文

## 3. 功能清单（按优先级）

1. 校验 macOS、CPU 架构和发行包完整性。
2. 检查 Lima；已有 Homebrew 时可确认后执行 `brew install lima`，没有 Homebrew 时给出官方安装命令并停止。
3. 将预编译 `macnas`、VM 模板和文档安装到 `~/.local/share/macnas`，在 `~/.local/bin/macnas` 提供命令入口。
4. 以 `macnas --lan` 启动内置 Web 控制台，打印本机与局域网访问地址。
5. 提供安全卸载：默认只移除程序；`--purge` 显式删除 MacNAS Lima 实例、管理数据盘、配置和数据镜像。
6. 不打包、不创建、不删除用户现有的 Docker 容器或镜像；删除 Lima 实例时仅删除该实例内部资源。

## 4. 命令接口设计

- `./install.sh`
  - 行为: 安装当前发行包，检查 Lima，打印启动命令，不自动占用当前终端。
- `./install.sh --start`
  - 行为: 安装后以前台方式启动 Web 服务，默认监听 `0.0.0.0:19808`。
- `macnas --lan`
  - 行为: 启动局域网可访问的 Web 服务。
- `macnas --host <IP> --port <端口>`
  - 行为: 使用指定监听地址和端口启动服务。
- `./uninstall.sh`
  - 行为: 停止并移除 MacNAS 安装文件与命令入口，保留配置、Lima 实例和数据。
- `./uninstall.sh --purge`
  - 行为: 输入 `DELETE` 后删除 MacNAS 实例、管理数据盘、配置、缓存和数据镜像；不删除 Homebrew、其他 Lima 实例或宿主机无关 Docker 数据。
- `./uninstall.sh --purge --uninstall-lima`
  - 行为: 在 `--purge` 基础上，确认后卸载 Homebrew 安装的 Lima。

## 5. 菜单设计

- 不启用交互菜单；安装、启动和卸载均使用明确命令。
- 破坏性清理必须输入 `DELETE` 二次确认。

## 6. 依赖与安装策略

- 包管理器策略: 仅 macOS Homebrew；不自动执行远程 Homebrew 安装脚本。
- 需要自动安装的依赖: 在用户确认后安装 Lima。
- 禁止自动安装的依赖: Homebrew；缺少时打印官方命令并要求用户自行执行。
- 发行包内不包含 Lima、Docker、Docker 镜像、Docker 容器、用户主目录数据或当前开发机配置。

## 7. 安全与风险控制

- 涉及高风险操作: 删除 Lima 实例、管理数据盘、配置和数据镜像。
- 是否要求二次确认: `--purge` 和卸载 Lima 均要求输入 `DELETE`。
- 禁止执行的操作: 不使用 `rm -rf` 删除用户主目录或整个 `~/MacNAS`；不执行 Docker 全局 prune；不删除其他 Lima 实例。
- 网络默认: 普通启动仍可使用回环地址；发行包的 `--start`/README 明确使用 `--lan` 才开放局域网。
- 首次管理员初始化: 为安全起见，只允许在运行 MacNAS 的 Mac 本机浏览器完成；完成后其他局域网设备可登录。

## 8. 日志与可观测性

- 前台启动: 日志直接输出到当前终端。
- 可选后台运行: 用户自行使用 `nohup`、`tmux` 或 macOS 服务管理器，不由安装脚本隐藏启动失败。
- 外部 telemetry: 不允许。

## 9. 输出与交付要求

- 发行包包含: `install.sh`、`uninstall.sh`、`bin/macnas`、`templates/`、`README.md`、`checksums.txt`。
- 构建脚本输出: 架构化 `tar.gz`、SHA-256 校验文件和验证结果。
- 不再生成或交付 DMG/Tauri App。

## 10. 验收命令

```bash
bash -n install.sh
bash -n uninstall.sh
shasum -a 256 -c checksums.txt
./bin/macnas --help
./bin/macnas --lan --port 19808
```

## 11. 备注

- 浏览器无法安全取得 macOS 本机绝对路径，因此纯 Web 发行版不提供原生文件夹选择器；目录直通需要在 Web 页面填写运行 MacNAS 的 Mac 本机路径。
- `web/dist` 在构建阶段嵌入 Go 二进制，最终用户不需要 Node.js。
