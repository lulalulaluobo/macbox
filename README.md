# MacNAS

MacNAS 是面向 macOS 的 NAS 控制台：桌面应用负责启动和管理本机服务，Lima 提供 Linux 虚拟机，虚拟机内运行 Docker、文件服务、SMB 和终端等能力。

## macOS 安装与首次初始化

1. 打开发布的 `MacNAS_*.dmg`，将 `MacNAS.app` 拖入“应用程序”。
2. 首次打开时，如果 macOS 阻止未签名应用，请在“系统设置 → 隐私与安全性”中允许后重新打开。
3. MacNAS 首次运行会进入初始化向导：
   - 先检查本机环境；未安装 Lima 时，会提供通过本机 Homebrew 安装 Lima 的按钮和命令。
   - 然后创建 MacNAS 专用的 `macnas` Lima 虚拟机和数据盘，并显示每一步的实时状态。
   - 初始化控制台账号固定为 `admin / admin123`；虚拟机 SSH 使用 `root` 密钥登录，不设置密码。
4. 初始化完成后进入控制台。建议首次登录后立即修改控制台密码，并按需配置外接数据盘、目录映射和 SMB 共享。

MacNAS 的数据镜像只保存虚拟机内部的系统与服务数据；映射进虚拟机的 macOS 目录仍然位于原来的 macOS 磁盘上，不会因为设置了镜像容量就复制一份到镜像中。虚拟机内 Docker 的容器、镜像和卷属于该 Lima 实例，删除实例会一并删除它们。

## 完整删除 MacNAS（重新模拟新用户）

下面的命令会删除当前 macOS 用户下的 MacNAS 应用、`macnas` Lima 虚拟机、`macnas-data` 管理磁盘、NAS 数据镜像、登录/初始化配置和 MacNAS 缓存，并卸载 Homebrew 安装的 Lima。虚拟机内的 Docker 容器、镜像和卷也会随实例删除。

不会删除：Homebrew 本身、其他 Lima 实例、宿主机上无关的 Docker 数据，也不会删除 `~/MacNAS` 目录中的其他文件；命令只处理其中的 `datadisk.img`。

执行前请确认镜像中的数据不再需要。命令会要求输入 `DELETE`，再执行删除：

```bash
/bin/bash <<'MACNAS_CLEANUP'
set -u

macnas_user="$(/usr/bin/id -un)"
macnas_home="$(/usr/bin/dscl . -read "/Users/${macnas_user}" NFSHomeDirectory | /usr/bin/sed 's/^NFSHomeDirectory: //')"

case "${macnas_home}" in
  ""|"/"|"/Users"|"/Users/Shared")
    /usr/bin/printf '%s\n' '无法确认当前用户的安全主目录，已停止。'
    exit 1
    ;;
esac

/usr/bin/printf '%s\n' '将删除 MacNAS 应用、macnas Lima 实例、macnas-data 管理磁盘、datadisk.img 和 MacNAS 配置。'
/usr/bin/printf '%s' '请输入 DELETE 确认：'
/usr/bin/read -r macnas_confirm
if [ "${macnas_confirm}" != "DELETE" ]; then
  /usr/bin/printf '%s\n' '已取消。'
  exit 0
fi

macnas_app='/Applications/MacNAS.app'
macnas_instance_dir="${macnas_home}/.lima/macnas"
macnas_disk_dir="${macnas_home}/.lima/_disks/macnas-data"
macnas_data_image="${macnas_home}/MacNAS/datadisk.img"
macnas_state_dir="${macnas_home}/.macnas"
macnas_support_dir="${macnas_home}/Library/Application Support/MacNAS"
macnas_webkit_dir="${macnas_home}/Library/WebKit/com.macnas.desktop"
macnas_cache_dir="${macnas_home}/Library/Caches/com.macnas.desktop"
macnas_cookie_file="${macnas_home}/Library/HTTPStorages/com.macnas.desktop.binarycookies"
macnas_launch_agent="${macnas_home}/Library/LaunchAgents/com.macnas.server.plist"

/usr/bin/osascript -e 'tell application "MacNAS" to quit' 2>/dev/null || true
/bin/launchctl bootout "gui/$(/usr/bin/id -u)" "${macnas_launch_agent}" 2>/dev/null || true

if /usr/bin/command -v limactl >/dev/null 2>&1; then
  limactl stop macnas --tty=false 2>/dev/null || true
  limactl delete macnas --force --tty=false 2>/dev/null || true
  limactl disk delete macnas-data --force --tty=false 2>/dev/null || true
fi

# 以下均为已固定的 MacNAS 专属路径，不删除 .lima 或 MacNAS 父目录。
/bin/rm -rf \
  "${macnas_app}" \
  "${macnas_instance_dir}" \
  "${macnas_disk_dir}" \
  "${macnas_state_dir}" \
  "${macnas_support_dir}" \
  "${macnas_webkit_dir}" \
  "${macnas_cache_dir}"
/bin/rm -f \
  "${macnas_data_image}" \
  "${macnas_cookie_file}" \
  "${macnas_launch_agent}"

if /usr/bin/command -v brew >/dev/null 2>&1 && brew list --formula lima >/dev/null 2>&1; then
  brew uninstall lima
fi

/usr/bin/printf '%s\n' 'MacNAS 清理完成。现在可以重新打开新的 DMG 进行安装和初始化。'
MACNAS_CLEANUP
```

如果之前把旧镜像移入废纸篓，清空废纸篓中的对应 MacNAS 清理目录后才会释放磁盘空间；不要为了清理 MacNAS 而直接清空包含其他文件的整个废纸篓。

## 构建 DMG

在 macOS 上执行：

```bash
cd desktop
bash scripts/build-mac-dmg.sh
```

产物位于 `desktop/src-tauri/target/release/bundle/dmg/`。当前脚本按构建机架构生成 sidecar；正式发布 Universal 版本时，需要同时准备 Apple Silicon 与 Intel sidecar。
