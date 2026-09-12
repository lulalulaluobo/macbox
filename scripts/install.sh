#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="${HOME}/.local/share/macnas"
BIN_DIR="${HOME}/.local/bin"
MENU_APP="${HOME}/Applications/MacNASMenu.app"
DEFAULT_PORT=19808
DEFAULT_HOST="0.0.0.0"
START_AFTER_INSTALL=0
PORT="${MACNAS_PORT:-$DEFAULT_PORT}"
HOST="${MACNAS_HOST:-$DEFAULT_HOST}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

log() {
  printf '[MacNAS] %s\n' "$*"
}

die() {
  printf '[MacNAS] 错误：%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
MacNAS macOS Web 服务安装器

用法：
  ./install.sh                  安装文件并打印下一步说明
  ./install.sh --start          安装完成后以前台方式启动 Web 服务
  ./install.sh --port 19808     指定启动端口（仅影响 --start）
  ./install.sh --host 0.0.0.0   指定启动监听地址（仅影响 --start）
  ./install.sh --help           显示帮助

安装位置：
  程序：~/.local/share/macnas
  命令：~/.local/bin/macnas

图形化入口：
  安装后双击 ~/Applications/MacNASMenu.app，可在 macOS 顶部菜单栏控制服务。
  MacNAS.command 仍可作为无菜单栏助手时的备用控制器。
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令 $1，请先安装后重试。"
}

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

ensure_lima() {
  if command -v limactl >/dev/null 2>&1; then
    log "已检测到 Lima：$(command -v limactl)"
    return
  fi

  local brew_path
  if ! brew_path="$(find_brew)"; then
    cat >&2 <<'MESSAGE'
[MacNAS] 未检测到 Lima 或 Homebrew。
请先按 Homebrew 官方说明安装 Homebrew，再重新执行本脚本：
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
MESSAGE
    exit 1
  fi

  if [[ ! -t 0 && "${MACNAS_AUTO_INSTALL_LIMA:-0}" != "1" ]]; then
    die "已找到 Homebrew 但未找到 Lima。交互终端中执行本脚本，或设置 MACNAS_AUTO_INSTALL_LIMA=1 后重试。安装命令：${brew_path} install lima"
  fi

  if [[ "${MACNAS_AUTO_INSTALL_LIMA:-0}" != "1" ]]; then
    printf '[MacNAS] 未检测到 Lima，是否通过 Homebrew 安装？[Y/n] '
    local answer
    read -r answer
    if [[ -n "$answer" && ! "$answer" =~ ^[Yy]$ ]]; then
      die "已取消 Lima 安装。稍后执行：${brew_path} install lima"
    fi
  fi

  log "正在安装 Lima（首次安装可能需要一点时间）..."
  "$brew_path" install lima
  PATH="$(dirname -- "$brew_path"):$PATH"
  export PATH
  command -v limactl >/dev/null 2>&1 || die "Lima 安装命令已完成，但当前 PATH 中仍找不到 limactl。请重新打开终端后执行 ./install.sh。"
  log "Lima 安装完成。"
}

validate_release() {
  [[ "$(uname -s)" == "Darwin" ]] || die "此发行包仅支持 macOS。"
  require_command uname
  require_command cp
  require_command mv
  require_command mktemp

  local machine expected binary_info
  machine="$(uname -m)"
  case "$machine" in
    arm64) expected="arm64" ;;
    x86_64) expected="x86_64" ;;
    *) die "不支持的 macOS CPU 架构：$machine" ;;
  esac

  [[ -x "$SCRIPT_DIR/bin/macnas" ]] || die "发行包不完整：缺少可执行文件 bin/macnas。"
  [[ -x "$SCRIPT_DIR/MacNAS.command" ]] || die "发行包不完整：缺少可执行文件 MacNAS.command。"
  [[ -d "$SCRIPT_DIR/MacNASMenu.app/Contents/MacOS" ]] || die "发行包不完整：缺少 MacNASMenu.app。"
  [[ -x "$SCRIPT_DIR/MacNASMenu.app/Contents/MacOS/MacNASMenu" ]] || die "发行包不完整：MacNASMenu.app 不可执行。"
  [[ -x "$SCRIPT_DIR/uninstall.sh" ]] || die "发行包不完整：缺少可执行文件 uninstall.sh。"
  [[ -d "$SCRIPT_DIR/templates/vm" ]] || die "发行包不完整：缺少 templates/vm。"
  require_command file
  require_command shasum
  binary_info="$(file -b "$SCRIPT_DIR/bin/macnas")"
  [[ "$binary_info" == *"$expected"* ]] || die "当前发行包与本机架构不匹配。当前机器：$machine；二进制信息：$binary_info"

  if [[ -f "$SCRIPT_DIR/checksums.txt" ]]; then
    (cd "$SCRIPT_DIR" && shasum -a 256 -c checksums.txt >/dev/null) || die "发行包校验失败，请重新下载。"
  fi
}

install_files() {
  local stage
  stage="$(mktemp -d "${TMPDIR:-/tmp}/macnas-install.XXXXXX")"
  trap 'rm -rf -- "$stage"' EXIT

  mkdir -p "$stage/bin"
  cp "$SCRIPT_DIR/bin/macnas" "$stage/bin/macnas"
  cp -R "$SCRIPT_DIR/templates" "$stage/templates"
  cp -R "$SCRIPT_DIR/MacNASMenu.app" "$stage/MacNASMenu.app"
  cp "$SCRIPT_DIR/uninstall.sh" "$stage/uninstall.sh"
  cp "$SCRIPT_DIR/MacNAS.command" "$stage/MacNAS.command"
  [[ ! -e "$SCRIPT_DIR/checksums.txt" ]] || cp "$SCRIPT_DIR/checksums.txt" "$stage/checksums.txt"
  chmod 0755 "$stage/bin/macnas" "$stage/uninstall.sh" "$stage/MacNAS.command" "$stage/MacNASMenu.app/Contents/MacOS/MacNASMenu"

  mkdir -p "$(dirname -- "$INSTALL_ROOT")"
  if [[ -e "$INSTALL_ROOT" || -L "$INSTALL_ROOT" ]]; then
    [[ "$INSTALL_ROOT" == "$HOME/.local/share/macnas" ]] || die "拒绝覆盖非预期安装目录：$INSTALL_ROOT"
    rm -rf -- "$INSTALL_ROOT"
  fi
  mv "$stage" "$INSTALL_ROOT"
  trap - EXIT

  mkdir -p "$(dirname -- "$MENU_APP")"
  [[ "$MENU_APP" == "$HOME/Applications/MacNASMenu.app" ]] || die "拒绝覆盖非预期菜单栏应用：$MENU_APP"
  rm -rf -- "$MENU_APP"
  cp -R "$INSTALL_ROOT/MacNASMenu.app" "$MENU_APP"
  chmod 0755 "$MENU_APP/Contents/MacOS/MacNASMenu"

  mkdir -p "$BIN_DIR"
  local command_path="${BIN_DIR}/macnas"
  if [[ -e "$command_path" || -L "$command_path" ]]; then
    if [[ -d "$command_path" && ! -L "$command_path" ]]; then
      die "命令入口路径是目录，未覆盖：$command_path"
    fi
    rm -f -- "$command_path"
  fi
  ln -s "${INSTALL_ROOT}/bin/macnas" "$command_path"
}

print_next_steps() {
  local lan_ip=""
  for interface in en0 en1; do
    lan_ip="$(/sbin/ipconfig getifaddr "$interface" 2>/dev/null || true)"
    [[ -n "$lan_ip" ]] && break
  done

  log "安装完成。"
  printf '\n下一步：\n'
  printf '  1. 在 Finder 中双击 ~/Applications/MacNASMenu.app，顶部栏会出现 MacNAS 图标。\n'
  printf '  2. 从顶部栏选择“启动后端服务”，再打开网页端完成首次初始化（首次登录时现场设置管理员用户名和至少 8 个字符的强密码）：\n'
  printf '     http://127.0.0.1:%s\n' "$PORT"
  if [[ -n "$lan_ip" ]]; then
    printf '  3. 初始化完成后，局域网其他设备访问：\n     http://%s:%s\n' "$lan_ip" "$PORT"
  fi
  printf '\n备用控制器：双击 MacNAS.command；命令行启动仍可使用：macnas --lan --port %s\n' "$PORT"
  printf '注意：首次管理员初始化只允许在运行 MacNAS 的 Mac 本机完成；完成后局域网设备可以登录。\n'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start)
      START_AFTER_INSTALL=1
      shift
      ;;
    --port)
      [[ $# -ge 2 ]] || die "--port 需要一个端口值。"
      PORT="$2"
      shift 2
      ;;
    --host)
      [[ $# -ge 2 ]] || die "--host 需要一个 IP 地址。"
      HOST="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "未知参数：$1。使用 ./install.sh --help 查看帮助。"
      ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "端口必须是 1–65535 之间的数字。"
[[ -n "$HOST" && "$HOST" != *[[:space:]]* ]] || die "监听地址不能为空或包含空格。"

validate_release
ensure_lima
install_files

if (( START_AFTER_INSTALL )); then
  log "正在以前台方式启动 MacNAS Web 服务，按 Ctrl+C 停止。"
  exec "$INSTALL_ROOT/bin/macnas" --host "$HOST" --port "$PORT"
fi

print_next_steps
