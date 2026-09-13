#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
VERSION="${MACBOX_VERSION:-$(awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' "$ROOT_DIR/web/package.json")}"
DIST_DIR="$ROOT_DIR/dist"
SIGN_IDENTITY="${MACBOX_CODESIGN_IDENTITY:--}"
NOTARY_PROFILE="${MACBOX_NOTARY_PROFILE:-}"
REQUESTED_ARCH=""
BUILD_ALL=0
ACTIVE_STAGE_DIR=""

log() {
  printf '[MacBox DMG] %s\n' "$*"
}

die() {
  printf '[MacBox DMG] 错误：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$ACTIVE_STAGE_DIR" && "$ACTIVE_STAGE_DIR" == "${TMPDIR:-/tmp}"/macbox-dmg.* ]]; then
    rm -rf -- "$ACTIVE_STAGE_DIR"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'USAGE'
MacBox macOS DMG 构建器

用法：
  scripts/build-mac-dmg.sh                  构建当前 Mac 架构
  scripts/build-mac-dmg.sh --arch aarch64  构建 Apple Silicon DMG
  scripts/build-mac-dmg.sh --arch x86_64   构建 Intel DMG
  scripts/build-mac-dmg.sh --all            构建两个架构
  scripts/build-mac-dmg.sh --help           显示帮助

签名：
  默认使用 ad-hoc 签名，不需要 Apple Developer ID。
  正式签名时设置 MACBOX_CODESIGN_IDENTITY。
  需要公证时同时设置 MACBOX_NOTARY_PROFILE（notarytool Keychain Profile）。

产物位于 dist/，每个 DMG 都会生成独立的 .sha256 文件。
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少构建依赖：$1"
}

normalize_arch() {
  case "$1" in
    arm64|aarch64)
      printf 'aarch64\n'
      ;;
    x86_64|amd64)
      printf 'x86_64\n'
      ;;
    *)
      return 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      [[ $# -ge 2 ]] || die "--arch 需要 aarch64 或 x86_64。"
      REQUESTED_ARCH="$(normalize_arch "$2")" || die "不支持的架构：$2"
      shift 2
      ;;
    --all)
      BUILD_ALL=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "未知参数：$1。使用 --help 查看帮助。"
      ;;
  esac
done

(( BUILD_ALL == 0 || ${#REQUESTED_ARCH} == 0 )) || die "--all 与 --arch 不能同时使用。"
[[ "$(uname -s)" == "Darwin" ]] || die "DMG 只能在 macOS 上构建。"
[[ -n "$VERSION" ]] || die "无法读取版本号。"

for dependency in go npm swiftc lipo codesign hdiutil shasum file; do
  require_command "$dependency"
done
[[ -x /usr/libexec/PlistBuddy ]] || die "缺少 /usr/libexec/PlistBuddy。"

if [[ -n "$NOTARY_PROFILE" && "$SIGN_IDENTITY" == "-" ]]; then
  die "设置 MACBOX_NOTARY_PROFILE 时必须同时提供 Developer ID 签名身份。"
fi
if [[ -n "$NOTARY_PROFILE" ]]; then
  require_command xcrun
fi

if (( BUILD_ALL )); then
  ARCHES=(aarch64 x86_64)
elif [[ -n "$REQUESTED_ARCH" ]]; then
  ARCHES=("$REQUESTED_ARCH")
else
  native_arch="$(normalize_arch "$(uname -m)")" || die "不支持当前 CPU 架构：$(uname -m)"
  ARCHES=("$native_arch")
fi

if [[ ! -d "$ROOT_DIR/web/node_modules" ]]; then
  log "安装锁定的前端构建依赖..."
  (cd "$ROOT_DIR/web" && npm ci)
fi
log "构建 Web 前端..."
(cd "$ROOT_DIR/web" && npm run build)

mkdir -p "$DIST_DIR"

sign_macho() {
  local target="$1"
  local identifier="$2"
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    codesign --force --sign - --options runtime --identifier "$identifier" "$target"
  else
    codesign --force --sign "$SIGN_IDENTITY" --timestamp --options runtime --identifier "$identifier" "$target"
  fi
}

sign_app() {
  local target="$1"
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    codesign --force --sign - --options runtime "$target"
  else
    codesign --force --sign "$SIGN_IDENTITY" --timestamp --options runtime "$target"
  fi
}

write_runtime_checksums() {
  local runtime_dir="$1"
  (
    cd "$runtime_dir"
    {
      find templates assets -type f -print
      printf '%s\n' LICENSE MACBOX_DEPLOYMENT_PROMPT.md MacBox.command README.md VERSION install.sh uninstall.sh
    } | LC_ALL=C sort | while IFS= read -r relative_path; do
      shasum -a 256 "$relative_path"
    done
  ) > "$runtime_dir/checksums.txt"
}

write_install_note() {
  local path="$1"
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    cat > "$path" <<'NOTE'
MacBox 安装说明

1. 将 MacBoxMemu.app 拖到右侧“Applications”。没有系统管理员权限时，也可以拖到个人目录下的“应用程序”。
2. 在 Finder 的“应用程序”中右键 MacBoxMemu.app，选择“打开”。
3. 如果 macOS 仍然阻止启动，请前往“系统设置 → 隐私与安全性”，确认来源可信后选择“仍要打开”。
4. 菜单栏出现 MacBox 图标后，选择“启动后端服务”，再在本机网页完成首次管理员初始化。
5. 初始化完成后，局域网设备可使用菜单提示的 http://局域网IP:19808 访问。

本测试版使用 ad-hoc 签名，尚未经过 Apple 公证。请从项目官方 GitHub Release 下载并核对 SHA-256。
不要全局关闭 Gatekeeper，也不要运行来源不明的解除安全限制命令。
NOTE
  else
    cat > "$path" <<'NOTE'
MacBox 安装说明

1. 将 MacBoxMemu.app 拖到右侧“Applications”。没有系统管理员权限时，也可以拖到个人目录下的“应用程序”。
2. 从“应用程序”启动 MacBoxMemu.app。
3. 菜单栏出现 MacBox 图标后，选择“启动后端服务”，再在本机网页完成首次管理员初始化。
4. 初始化完成后，局域网设备可使用菜单提示的 http://局域网IP:19808 访问。
NOTE
  fi
}

build_dmg() {
  local release_arch="$1"
  local goarch swift_arch package_name dmg_name dmg_path sha_path stage_dir volume_dir app_path runtime_dir helper_path
  local helper_digest runtime_digest actual_arches menu_arches
  case "$release_arch" in
    aarch64)
      goarch=arm64
      swift_arch=arm64
      ;;
    x86_64)
      goarch=amd64
      swift_arch=x86_64
      ;;
    *)
      die "内部架构映射错误：$release_arch"
      ;;
  esac

  package_name="MacBox_${VERSION}_macos_${release_arch}"
  dmg_name="${package_name}.dmg"
  dmg_path="$DIST_DIR/$dmg_name"
  sha_path="$dmg_path.sha256"
  stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/macbox-dmg.XXXXXX")"
  volume_dir="$stage_dir/volume"
  app_path="$volume_dir/MacBoxMemu.app"
  runtime_dir="$app_path/Contents/Resources/runtime"
  helper_path="$app_path/Contents/Helpers/macbox"

  ACTIVE_STAGE_DIR="$stage_dir"

  log "组装 $release_arch 菜单栏应用..."
  mkdir -p "$volume_dir"
  "$ROOT_DIR/scripts/build-macos-menu-app.sh" "$app_path" "$swift_arch"
  mkdir -p "$app_path/Contents/Helpers" "$runtime_dir"

  log "编译 $release_arch Go 后端..."
  CGO_ENABLED=0 GOOS=darwin GOARCH="$goarch" go build \
    -trimpath -ldflags='-s -w' \
    -o "$helper_path" "$ROOT_DIR/cmd/macbox"

  cp -R "$ROOT_DIR/templates" "$runtime_dir/templates"
  cp -R "$ROOT_DIR/assets" "$runtime_dir/assets"
  cp "$ROOT_DIR/scripts/install.sh" "$runtime_dir/install.sh"
  cp "$ROOT_DIR/scripts/uninstall.sh" "$runtime_dir/uninstall.sh"
  cp "$ROOT_DIR/scripts/macbox.command" "$runtime_dir/MacBox.command"
  cp "$ROOT_DIR/MACBOX_DEPLOYMENT_PROMPT.md" "$runtime_dir/MACBOX_DEPLOYMENT_PROMPT.md"
  cp "$ROOT_DIR/README.md" "$runtime_dir/README.md"
  cp "$ROOT_DIR/LICENSE" "$runtime_dir/LICENSE"
  printf '%s\n' "$VERSION" > "$runtime_dir/VERSION"
  chmod 0755 "$helper_path" "$runtime_dir/install.sh" "$runtime_dir/uninstall.sh" "$runtime_dir/MacBox.command"

  log "签名内部后端并封装 App..."
  sign_macho "$helper_path" "io.github.lulalulaluobo.macbox.backend"
  write_runtime_checksums "$runtime_dir"
  helper_digest="$(shasum -a 256 "$helper_path" | awk '{print $1}')"
  runtime_digest="$(shasum -a 256 "$runtime_dir/checksums.txt" | awk '{print $1}')"
  printf '%s:%s\n' "$helper_digest" "$runtime_digest" > "$runtime_dir/BUILD_ID"
  sign_app "$app_path"

  codesign --verify --strict --verbose=2 "$helper_path"
  codesign --verify --strict --verbose=2 "$app_path"
  actual_arches="$(lipo -archs "$helper_path")"
  [[ " $actual_arches " == *" $swift_arch "* ]] || die "后端架构校验失败：期望 $swift_arch，实际 $actual_arches"
  menu_arches="$(lipo -archs "$app_path/Contents/MacOS/MacBoxMemu")"
  [[ " $menu_arches " == *" $swift_arch "* ]] || die "菜单栏架构校验失败：期望 $swift_arch，实际 $menu_arches"

  ln -s /Applications "$volume_dir/Applications"
  write_install_note "$volume_dir/安装说明.txt"

  [[ "$dmg_path" == "$DIST_DIR"/MacBox_*_macos_*.dmg ]] || die "拒绝覆盖非预期 DMG 路径：$dmg_path"
  rm -f -- "$dmg_path" "$sha_path"
  log "创建 $dmg_name..."
  hdiutil create -quiet -ov -format UDZO -imagekey zlib-level=9 \
    -volname "MacBox ${VERSION}" -srcfolder "$volume_dir" "$dmg_path"

  if [[ "$SIGN_IDENTITY" != "-" ]]; then
    codesign --force --sign "$SIGN_IDENTITY" --timestamp "$dmg_path"
  fi
  if [[ -n "$NOTARY_PROFILE" ]]; then
    log "提交 Apple 公证..."
    xcrun notarytool submit "$dmg_path" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$dmg_path"
    xcrun stapler validate "$dmg_path"
  fi

  hdiutil verify "$dmg_path" >/dev/null
  (
    cd "$DIST_DIR"
    shasum -a 256 "$dmg_name" > "$dmg_name.sha256"
  )
  log "完成：$dmg_path"
  log "SHA-256：$(awk '{print $1}' "$sha_path")"

  rm -rf -- "$stage_dir"
  ACTIVE_STAGE_DIR=""
}

for target_arch in "${ARCHES[@]}"; do
  build_dmg "$target_arch"
done

log "所有 DMG 构建与验证完成。"
