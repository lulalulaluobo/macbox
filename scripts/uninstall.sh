#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${HOME}/.local/share/macbox"
COMMAND_PATH="${HOME}/.local/bin/macbox"
MENU_APP="${HOME}/Applications/MacBoxMemu.app"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.macbox.server.plist"
LIMA_INSTANCE_NAME="macbox"
DATA_DISK_NAME="macbox-data"
LIMA_INSTANCE_DIR="${HOME}/.lima/${LIMA_INSTANCE_NAME}"
LIMA_DISK_DIR="${HOME}/.lima/_disks/${DATA_DISK_NAME}"
DATA_IMAGE="${HOME}/MacBox/datadisk.img"
STATE_DIR="${HOME}/.macbox"
PURGE=0
UNINSTALL_LIMA=0

usage() {
  cat <<'USAGE'
MacBox macOS Web 服务卸载器

用法：
  ./uninstall.sh                         移除程序，保留配置、虚拟机和数据
  ./uninstall.sh --purge                 输入 DELETE 后删除 MacBox 实例与数据
  ./uninstall.sh --purge --uninstall-lima
                                         同时卸载 Homebrew 安装的 Lima
  ./uninstall.sh --help                  显示帮助

--purge 会删除：MacBox Lima 实例、macbox-data 管理盘、~/.macbox 配置、
~/MacBox/datadisk.img。不会删除其他 Lima 实例、Homebrew 或宿主机无关的
Docker 容器/镜像。
USAGE
}

die() {
  printf '[MacBox] 错误：%s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)
      PURGE=1
      shift
      ;;
    --uninstall-lima)
      UNINSTALL_LIMA=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "未知参数：$1。使用 ./uninstall.sh --help 查看帮助。"
      ;;
  esac
done

(( UNINSTALL_LIMA == 0 || PURGE == 1 )) || die "--uninstall-lima 必须与 --purge 一起使用。"

read_vm_value() {
  local key="$1"
  [[ -f "${STATE_DIR}/config.yaml" ]] || return 0
  awk -v key="$key" '
    /^vm:[[:space:]]*$/ { in_vm=1; next }
    in_vm && /^[^[:space:]]/ { in_vm=0 }
    in_vm && $1 == key ":" {
      sub(/^[^:]+:[[:space:]]*/, "")
      print
      exit
    }
  ' "${STATE_DIR}/config.yaml"
}

configured_vm_name="$(read_vm_value name || true)"
configured_disk_name="$(read_vm_value dataDiskName || true)"
if [[ "$configured_vm_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  LIMA_INSTANCE_NAME="$configured_vm_name"
fi
if [[ "$configured_disk_name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  DATA_DISK_NAME="$configured_disk_name"
fi
LIMA_INSTANCE_DIR="${HOME}/.lima/${LIMA_INSTANCE_NAME}"
LIMA_DISK_DIR="${HOME}/.lima/_disks/${DATA_DISK_NAME}"

[[ "$INSTALL_ROOT" == "$HOME/.local/share/macbox" ]] || die "安装目录安全校验失败。"
[[ "$STATE_DIR" == "$HOME/.macbox" ]] || die "配置目录安全校验失败。"
[[ "$DATA_IMAGE" == "$HOME/MacBox/datadisk.img" ]] || die "数据镜像路径安全校验失败。"

if (( PURGE )); then
  cat <<WARNING
即将清理 MacBox 专属资源：
  - Lima 实例：${LIMA_INSTANCE_NAME}
  - Lima 管理数据盘：${DATA_DISK_NAME}
  - MacBox 配置：~/.macbox
  - 数据镜像：~/MacBox/datadisk.img

这会删除该 Lima 实例内的 Docker 容器、镜像和卷，但不会触碰其他 Lima 实例或宿主机无关 Docker 数据。
WARNING
  printf '请输入 DELETE 确认：'
  read -r confirmation
  [[ "$confirmation" == "DELETE" ]] || { printf '已取消。\n'; exit 0; }
fi

uid="$(id -u)"
if command -v launchctl >/dev/null 2>&1; then
  launchctl bootout "gui/${uid}" "$PLIST_PATH" 2>/dev/null || true
fi
rm -f -- "$PLIST_PATH"

if (( PURGE )) && command -v limactl >/dev/null 2>&1; then
  limactl stop "$LIMA_INSTANCE_NAME" --tty=false 2>/dev/null || true
  limactl delete "$LIMA_INSTANCE_NAME" --force --tty=false 2>/dev/null || true
  limactl disk delete "$DATA_DISK_NAME" --force --tty=false 2>/dev/null || true
fi

if [[ -L "$COMMAND_PATH" ]]; then
  target="$(readlink "$COMMAND_PATH" || true)"
  [[ "$target" == "$INSTALL_ROOT/bin/macbox" ]] && rm -f -- "$COMMAND_PATH"
elif [[ -f "$COMMAND_PATH" ]]; then
  printf '[MacBox] 保留非 MacBox 命令文件：%s\n' "$COMMAND_PATH"
fi

rm -rf -- "$INSTALL_ROOT"
if [[ "$MENU_APP" == "$HOME/Applications/MacBoxMemu.app" ]]; then
  rm -rf -- "$MENU_APP"
fi

if (( PURGE )); then
  # The explicit paths are MacBox-owned fallbacks for a machine where
  # limactl is already missing or cannot remove a stale stopped instance.
  rm -rf -- "$LIMA_INSTANCE_DIR" "$LIMA_DISK_DIR"
  rm -rf -- "$STATE_DIR"
  rm -f -- "$DATA_IMAGE"
  if (( UNINSTALL_LIMA )); then
    brew_path=""
    if command -v brew >/dev/null 2>&1; then
      brew_path="$(command -v brew)"
    elif [[ -x /opt/homebrew/bin/brew ]]; then
      brew_path=/opt/homebrew/bin/brew
    elif [[ -x /usr/local/bin/brew ]]; then
      brew_path=/usr/local/bin/brew
    fi
    [[ -n "$brew_path" ]] || die "未找到 Homebrew，无法执行 Lima 卸载；MacBox 资源已经清理完成。"
    if "$brew_path" list --formula lima >/dev/null 2>&1; then
      "$brew_path" uninstall lima
    else
      printf '[MacBox] Homebrew 中未安装 Lima，跳过。\n'
    fi
  fi
  printf '[MacBox] 程序、Lima 实例、管理数据盘、配置和数据镜像已清理。\n'
else
  printf '[MacBox] 程序已移除；配置、Lima 实例和数据已保留。需要完全清理时执行 ./uninstall.sh --purge。\n'
fi
