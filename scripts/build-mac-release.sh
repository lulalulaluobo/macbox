#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
VERSION="${MACBOX_VERSION:-$(awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' "$ROOT_DIR/web/package.json")}"
TARGET_ARCH="${MACBOX_GOARCH:-$(uname -m)}"

case "$TARGET_ARCH" in
  arm64|aarch64)
    GOARCH_VALUE=arm64
    RELEASE_ARCH=aarch64
    ;;
  x86_64|amd64)
    GOARCH_VALUE=amd64
    RELEASE_ARCH=x86_64
    ;;
  *)
    printf '[MacBox] 不支持的目标架构：%s\n' "$TARGET_ARCH" >&2
    exit 1
    ;;
esac

DIST_DIR="$ROOT_DIR/dist"
ARCHIVE_NAME="MacBox_${VERSION}_macos_${RELEASE_ARCH}.tar.gz"
ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/macbox-release.XXXXXX")"
PACKAGE_NAME="MacBox_${VERSION}_macos_${RELEASE_ARCH}"
PACKAGE_DIR="$STAGE_DIR/$PACKAGE_NAME"
trap 'rm -rf -- "$STAGE_DIR"' EXIT

printf '[MacBox] 构建 macOS Web 服务发行包：%s\n' "$RELEASE_ARCH"
command -v go >/dev/null 2>&1 || { printf '[MacBox] 缺少 Go。\n' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { printf '[MacBox] 缺少 npm。\n' >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { printf '[MacBox] 缺少 tar。\n' >&2; exit 1; }
command -v shasum >/dev/null 2>&1 || { printf '[MacBox] 缺少 shasum。\n' >&2; exit 1; }

if [[ ! -d "$ROOT_DIR/web/node_modules" ]]; then
  printf '[MacBox] 安装前端构建依赖...\n'
  (cd "$ROOT_DIR/web" && npm ci)
fi

printf '[MacBox] 构建前端并嵌入 Go 二进制...\n'
(cd "$ROOT_DIR/web" && npm run build)

mkdir -p "$PACKAGE_DIR/bin"
CGO_ENABLED=0 GOOS=darwin GOARCH="$GOARCH_VALUE" go build \
  -trimpath -ldflags='-s -w' \
  -o "$PACKAGE_DIR/bin/macbox" "$ROOT_DIR/cmd/macbox"
cp -R "$ROOT_DIR/templates" "$PACKAGE_DIR/templates"
cp -R "$ROOT_DIR/assets" "$PACKAGE_DIR/assets"
cp "$ROOT_DIR/scripts/install.sh" "$PACKAGE_DIR/install.sh"
cp "$ROOT_DIR/scripts/uninstall.sh" "$PACKAGE_DIR/uninstall.sh"
cp "$ROOT_DIR/LICENSE" "$PACKAGE_DIR/LICENSE"
# docs/ is intentionally excluded from the source release. Keep the package
# self-describing by using the tracked project README as its release guide.
cp "$ROOT_DIR/README.md" "$PACKAGE_DIR/README.md"
cp "$ROOT_DIR/scripts/macbox.command" "$PACKAGE_DIR/MacBox.command"
chmod 0755 "$PACKAGE_DIR/bin/macbox" "$PACKAGE_DIR/install.sh" "$PACKAGE_DIR/uninstall.sh" "$PACKAGE_DIR/MacBox.command"

"$ROOT_DIR/scripts/build-macos-menu-app.sh" "$PACKAGE_DIR/MacBoxMemu.app"

(
  cd "$PACKAGE_DIR"
  {
    find bin templates assets MacBoxMemu.app/Contents -type f -print
    printf '%s\n' LICENSE MacBox.command install.sh uninstall.sh
  } | sort | xargs shasum -a 256
) > "$PACKAGE_DIR/checksums.txt"

mkdir -p "$DIST_DIR"
rm -f -- "$ARCHIVE_PATH"
tar -czf "$ARCHIVE_PATH" -C "$STAGE_DIR" "$PACKAGE_NAME"
(
  cd "$DIST_DIR"
  shasum -a 256 "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256"
)

printf '\n[MacBox] 构建完成：%s\n' "$ARCHIVE_PATH"
printf '[MacBox] SHA-256：%s\n' "$(awk '{print $1}' "$ARCHIVE_PATH.sha256")"
printf '[MacBox] 包含：MacBoxMemu.app、MacBox.command、install.sh、uninstall.sh、预编译 macbox、templates、README 和截图；不包含 DMG、Docker 镜像、容器或用户数据。\n'
