#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${HOME}/.local/share/macnas"
COMMAND_PATH="${HOME}/.local/bin/macnas"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.macnas.server.plist"
LIMA_INSTANCE_DIR="${HOME}/.lima/macnas"
LIMA_DISK_DIR="${HOME}/.lima/_disks/macnas-data"
DATA_IMAGE="${HOME}/MacNAS/datadisk.img"
STATE_DIR="${HOME}/.macnas"
PURGE=0
UNINSTALL_LIMA=0

usage() {
  cat <<'USAGE'
MacNAS macOS Web 服务卸载器

用法：
  ./uninstall.sh                         移除程序，保留配置、虚拟机和数据
  ./uninstall.sh --purge                 输入 DELETE 后删除 MacNAS 实例与数据
  ./uninstall.sh --purge --uninstall-lima
                                         同时卸载 Homebrew 安装的 Lima
  ./uninstall.sh --help                  显示帮助

--purge 会删除：MacNAS Lima 实例、macnas-data 管理盘、~/.macnas 配置、
~/MacNAS/datadisk.img。不会删除其他 Lima 实例、Homebrew 或宿主机无关的
Docker 容器/镜像。
USAGE
}

die() {
  printf '[MacNAS] 错误：%s\n' "$*" >&2
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

[[ "$INSTALL_ROOT" == "$HOME/.local/share/macnas" ]] || die "安装目录安全校验失败。"
[[ "$STATE_DIR" == "$HOME/.macnas" ]] || die "配置目录安全校验失败。"
[[ "$DATA_IMAGE" == "$HOME/MacNAS/datadisk.img" ]] || die "数据镜像路径安全校验失败。"

if (( PURGE )); then
  cat <<'WARNING'
即将清理 MacNAS 专属资源：
  - Lima 实例：macnas
  - Lima 管理数据盘：macnas-data
  - MacNAS 配置：~/.macnas
  - 数据镜像：~/MacNAS/datadisk.img

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
  limactl stop macnas --tty=false 2>/dev/null || true
  limactl delete macnas --force --tty=false 2>/dev/null || true
  limactl disk delete macnas-data --force --tty=false 2>/dev/null || true
fi

if [[ -L "$COMMAND_PATH" ]]; then
  target="$(readlink "$COMMAND_PATH" || true)"
  [[ "$target" == "$INSTALL_ROOT/bin/macnas" ]] && rm -f -- "$COMMAND_PATH"
elif [[ -f "$COMMAND_PATH" ]]; then
  printf '[MacNAS] 保留非 MacNAS 命令文件：%s\n' "$COMMAND_PATH"
fi

rm -rf -- "$INSTALL_ROOT"

if (( PURGE )); then
  # The explicit paths are MacNAS-owned fallbacks for a machine where
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
    [[ -n "$brew_path" ]] || die "未找到 Homebrew，无法执行 Lima 卸载；MacNAS 资源已经清理完成。"
    if "$brew_path" list --formula lima >/dev/null 2>&1; then
      "$brew_path" uninstall lima
    else
      printf '[MacNAS] Homebrew 中未安装 Lima，跳过。\n'
    fi
  fi
  printf '[MacNAS] 程序、Lima 实例、管理数据盘、配置和数据镜像已清理。\n'
else
  printf '[MacNAS] 程序已移除；配置、Lima 实例和数据已保留。需要完全清理时执行 ./uninstall.sh --purge。\n'
fi
