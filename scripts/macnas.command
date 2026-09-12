#!/usr/bin/env bash
set -Eeuo pipefail

# Finder can launch a .command file from any working directory. Resolve all
# release assets from this file so paths never depend on the user's username
# or the directory from which Terminal happened to be opened.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALL_ROOT="${HOME}/.local/share/macnas"
BIN_PATH="${INSTALL_ROOT}/bin/macnas"
INSTALL_SCRIPT="${SCRIPT_DIR}/install.sh"
UNINSTALL_SCRIPT="${SCRIPT_DIR}/uninstall.sh"
STATE_DIR="${HOME}/.macnas"
PID_FILE="${STATE_DIR}/macnas.command.pid"
LOG_FILE="${STATE_DIR}/macnas.command.log"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.macnas.server.plist"
PORT="${MACNAS_PORT:-19808}"
HOST="${MACNAS_HOST:-0.0.0.0}"

ui_choose() {
  /usr/bin/osascript - <<'APPLESCRIPT'
set choices to {"启动 MacNAS", "停止 MacNAS", "彻底卸载（实例、镜像和数据）", "退出"}
set picked to choose from list choices with title "MacNAS 控制中心" with prompt "请选择要执行的操作：" default items {"启动 MacNAS"}
if picked is false then
  return "退出"
end if
return item 1 of picked
APPLESCRIPT
}

ui_message() {
  local title="$1"
  local message="$2"
  /usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT'
on run argv
  display dialog (item 2 of argv) with title (item 1 of argv) buttons {"好"} default button "好"
end run
APPLESCRIPT
}

ui_confirm() {
  local title="$1"
  local message="$2"
  local answer
  answer="$(/usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT'
on run argv
  set result to display dialog (item 2 of argv) with title (item 1 of argv) buttons {"取消", "确定"} default button "取消" with icon caution
  return button returned of result
end run
APPLESCRIPT
)" || return 1
  [[ "$answer" == "确定" ]]
}

valid_port() {
  [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 ))
}

pid_matches_macnas() {
  local pid="$1"
  local command_line
  command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ -n "$command_line" && "$command_line" == *"$BIN_PATH"* ]]
}

owned_pid() {
  local pid=""
  if [[ -f "$PID_FILE" ]]; then
    pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
  fi
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && pid_matches_macnas "$pid"; then
    printf '%s\n' "$pid"
    return 0
  fi
  rm -f -- "$PID_FILE"
  return 1
}

macnas_port_pid() {
  local pid=""
  while IFS= read -r pid; do
    if [[ "$pid" =~ ^[0-9]+$ ]] && pid_matches_macnas "$pid"; then
      printf '%s\n' "$pid"
      return 0
    fi
  done < <(/usr/sbin/lsof -ti TCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  return 1
}

port_in_use() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

ensure_installed() {
  if [[ -x "$BIN_PATH" ]]; then
    return 0
  fi
  if [[ ! -x "$INSTALL_SCRIPT" ]]; then
    ui_message "MacNAS 安装失败" "发行包不完整，找不到 install.sh。请重新解压完整的 MacNAS 发行包。"
    return 1
  fi
  if ! ui_confirm "首次安装 MacNAS" "尚未检测到已安装的 MacNAS。现在安装程序并检查 Lima 环境吗？"; then
    return 1
  fi
  if ! "$INSTALL_SCRIPT"; then
    ui_message "MacNAS 安装失败" "安装没有完成。请查看终端中的错误信息，或检查 Homebrew/Lima 是否可用。"
    return 1
  fi
  [[ -x "$BIN_PATH" ]] || {
    ui_message "MacNAS 安装失败" "安装脚本已返回，但找不到已安装的 MacNAS 可执行文件。"
    return 1
  }
}

start_service() {
  valid_port || {
    ui_message "MacNAS 启动失败" "端口无效：$PORT。请设置 MACNAS_PORT 为 1–65535 的端口。"
    return 1
  }
  ensure_installed || return 1

  local pid=""
  if pid="$(owned_pid)" || pid="$(macnas_port_pid)"; then
    /usr/bin/open "http://127.0.0.1:${PORT}"
    ui_message "MacNAS 已在运行" $'MacNAS 已经运行（PID '"$pid"$'）。\n\n本机地址：http://127.0.0.1:'"${PORT}"$'\n局域网地址：http://<Mac局域网IP>:'"${PORT}"
    return 0
  fi
  if port_in_use; then
    /usr/bin/open "http://127.0.0.1:${PORT}" || true
    ui_message "MacNAS 启动失败" "端口 ${PORT} 已被其他程序占用。请停止占用该端口的程序，或设置 MACNAS_PORT 后重试。"
    return 1
  fi

  umask 077
  mkdir -p "$STATE_DIR"
  : > "$LOG_FILE"
  nohup "$BIN_PATH" --host "$HOST" --port "$PORT" >>"$LOG_FILE" 2>&1 < /dev/null &
  pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"

  local ready=0
  for _ in {1..20}; do
    if /usr/bin/curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.5
  done

  /usr/bin/open "http://127.0.0.1:${PORT}"
  if (( ready )); then
    ui_message "MacNAS 已启动" $'Web 服务已启动并支持局域网访问。\n\n本机地址：http://127.0.0.1:'"${PORT}"$'\n局域网地址：http://<Mac局域网IP>:'"${PORT}"$'\n\n日志：'"${LOG_FILE}"
  else
    ui_message "MacNAS 正在启动" $'启动命令已执行，但服务仍在初始化。请稍后刷新浏览器。\n\n日志：'"${LOG_FILE}"
  fi
}

stop_service() {
  local stopped=0
  local pid=""
  if pid="$(owned_pid)" || pid="$(macnas_port_pid)"; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f -- "$PID_FILE"
    stopped=1
  fi

  # Also stop a MacNAS LaunchAgent created by the CLI service command. The
  # exact plist path is fixed and owned by MacNAS, so this cannot unload an
  # unrelated user service.
  if [[ -f "$PLIST_PATH" ]]; then
    local uid
    uid="$(id -u)"
    /bin/launchctl bootout "gui/${uid}" "$PLIST_PATH" >/dev/null 2>&1 || true
    rm -f -- "$PLIST_PATH"
    stopped=1
  fi

  if (( stopped )); then
    ui_message "MacNAS 已停止" "MacNAS Web 服务已停止。再次双击 MacNAS.command 可重新启动。"
  else
    ui_message "MacNAS 未运行" "没有找到由 MacNAS 控制器或 MacNAS LaunchAgent 启动的服务。"
  fi
}

uninstall_all() {
  if [[ ! -x "$UNINSTALL_SCRIPT" ]]; then
    ui_message "卸载失败" "发行包不完整，找不到 uninstall.sh。请重新解压完整的 MacNAS 发行包。"
    return 1
  fi
  if ! ui_confirm "确认彻底卸载" $'这将删除 MacNAS Lima 实例、管理盘、数据镜像、Docker 容器/镜像/卷、配置和程序。\n\n其他 Lima 实例和宿主机无关数据不会被删除。继续吗？'; then
    return 0
  fi

  local uninstall_lima=0
  if ui_confirm "是否卸载 Lima" "MacNAS 专属资源清理完成后，是否同时卸载 Homebrew 安装的 Lima 程序？"; then
    uninstall_lima=1
  fi

  stop_service >/dev/null 2>&1 || true
  local status=0
  if (( uninstall_lima )); then
    "$UNINSTALL_SCRIPT" --purge --uninstall-lima || status=$?
  else
    "$UNINSTALL_SCRIPT" --purge || status=$?
  fi
  if (( status != 0 )); then
    ui_message "卸载失败" "彻底卸载没有完成，请查看当前终端中的详细错误信息。"
    return "$status"
  fi
  ui_message "MacNAS 已卸载" $'MacNAS 实例、镜像、Docker 资源和配置已清理。\n\n发行包所在的下载文件夹仍保留，如不再需要可手动删除。'
}

usage() {
  cat <<'USAGE'
MacNAS macOS 双击控制器

双击运行：显示原生 macOS 菜单。

命令行：
  MacNAS.command start                         安装（如需要）并启动 Web 服务
  MacNAS.command stop                          停止 Web 服务
  MacNAS.command uninstall                     删除实例、镜像、Docker 资源和配置
  MacNAS.command uninstall --uninstall-lima   同时卸载 Homebrew Lima
USAGE
}

if [[ "$#" -gt 0 ]]; then
  case "$1" in
    start|--start)
      start_service
      ;;
    stop|--stop)
      stop_service
      ;;
    uninstall|--uninstall)
      if [[ "${2:-}" == "--uninstall-lima" ]]; then
        # Keep the destructive flow identical to the menu, but allow a
        # scripted explicit choice for maintainers.
        if [[ -x "$UNINSTALL_SCRIPT" ]] && ui_confirm "确认彻底卸载" "将删除 MacNAS 实例、镜像、Docker 资源、配置并卸载 Lima。继续吗？"; then
          stop_service >/dev/null 2>&1 || true
          "$UNINSTALL_SCRIPT" --purge --uninstall-lima
        fi
      else
        uninstall_all
      fi
      ;;
    --help|-h)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  exit $?
fi

choice="$(ui_choose)"
case "$choice" in
  "启动 MacNAS")
    start_service
    ;;
  "停止 MacNAS")
    stop_service
    ;;
  "彻底卸载（实例、镜像和数据）")
    uninstall_all
    ;;
  *)
    exit 0
    ;;
esac
