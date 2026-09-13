#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT="${1:-$ROOT_DIR/dist/MacBoxMemu.app}"
TARGET_ARCH="${2:-universal}"
SOURCE="$ROOT_DIR/macos-menu/main.swift"
INFO_PLIST="$ROOT_DIR/macos-menu/Info.plist"
VERSION="${MACBOX_VERSION:-$(awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' "$ROOT_DIR/web/package.json")}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/macbox-menu.XXXXXX")"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

[[ "$(uname -s)" == "Darwin" ]] || { printf '[MacBox] 菜单栏助手只能在 macOS 上构建。\n' >&2; exit 1; }
command -v swiftc >/dev/null 2>&1 || { printf '[MacBox] 缺少 swiftc，请安装 Xcode Command Line Tools。\n' >&2; exit 1; }
command -v lipo >/dev/null 2>&1 || { printf '[MacBox] 缺少 lipo，请安装 Xcode Command Line Tools。\n' >&2; exit 1; }
[[ -f "$SOURCE" && -f "$INFO_PLIST" ]] || { printf '[MacBox] 菜单栏助手源文件不完整。\n' >&2; exit 1; }

mkdir -p "$TEMP_DIR/build" "$TEMP_DIR/Contents/MacOS" "$TEMP_DIR/Contents/Resources"

build_arch() {
  local arch="$1"
  swiftc -O -parse-as-library -target "${arch}-apple-macos13.0" \
    -framework AppKit -framework Foundation \
    -o "$TEMP_DIR/build/MacBoxMemu-${arch}" "$SOURCE"
}

case "$TARGET_ARCH" in
  universal)
    build_arch arm64
    build_arch x86_64
    lipo -create "$TEMP_DIR/build/MacBoxMemu-arm64" "$TEMP_DIR/build/MacBoxMemu-x86_64" \
      -output "$TEMP_DIR/Contents/MacOS/MacBoxMemu"
    ;;
  arm64|aarch64)
    build_arch arm64
    mv "$TEMP_DIR/build/MacBoxMemu-arm64" "$TEMP_DIR/Contents/MacOS/MacBoxMemu"
    ;;
  x86_64|amd64)
    build_arch x86_64
    mv "$TEMP_DIR/build/MacBoxMemu-x86_64" "$TEMP_DIR/Contents/MacOS/MacBoxMemu"
    ;;
  *)
    printf '[MacBox] 不支持的菜单栏目标架构：%s\n' "$TARGET_ARCH" >&2
    exit 1
    ;;
esac
rm -rf -- "$TEMP_DIR/build"
cp "$INFO_PLIST" "$TEMP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$TEMP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$TEMP_DIR/Contents/Info.plist"
if [[ -f "$ROOT_DIR/desktop/src-tauri/icons/icon.icns" ]]; then
  cp "$ROOT_DIR/desktop/src-tauri/icons/icon.icns" "$TEMP_DIR/Contents/Resources/AppIcon.icns"
fi
chmod 0755 "$TEMP_DIR/Contents/MacOS/MacBoxMemu"

rm -rf -- "$OUTPUT"
mkdir -p "$(dirname -- "$OUTPUT")"
mv "$TEMP_DIR" "$OUTPUT"
printf '[MacBox] 菜单栏助手构建完成：%s（%s，版本 %s）\n' "$OUTPUT" "$TARGET_ARCH" "$VERSION"
