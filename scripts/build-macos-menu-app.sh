#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUTPUT="${1:-$ROOT_DIR/dist/MacNASMenu.app}"
SOURCE="$ROOT_DIR/macos-menu/main.swift"
INFO_PLIST="$ROOT_DIR/macos-menu/Info.plist"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/macnas-menu.XXXXXX")"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

[[ "$(uname -s)" == "Darwin" ]] || { printf '[MacNAS] 菜单栏助手只能在 macOS 上构建。\n' >&2; exit 1; }
command -v swiftc >/dev/null 2>&1 || { printf '[MacNAS] 缺少 swiftc，请安装 Xcode Command Line Tools。\n' >&2; exit 1; }
command -v lipo >/dev/null 2>&1 || { printf '[MacNAS] 缺少 lipo，请安装 Xcode Command Line Tools。\n' >&2; exit 1; }
[[ -f "$SOURCE" && -f "$INFO_PLIST" ]] || { printf '[MacNAS] 菜单栏助手源文件不完整。\n' >&2; exit 1; }

mkdir -p "$TEMP_DIR/build" "$TEMP_DIR/Contents/MacOS" "$TEMP_DIR/Contents/Resources"

build_arch() {
  local arch="$1"
  swiftc -O -parse-as-library -target "${arch}-apple-macos13.0" \
    -framework AppKit -framework Foundation \
    -o "$TEMP_DIR/build/MacNASMenu-${arch}" "$SOURCE"
}

build_arch arm64
build_arch x86_64
lipo -create "$TEMP_DIR/build/MacNASMenu-arm64" "$TEMP_DIR/build/MacNASMenu-x86_64" \
  -output "$TEMP_DIR/Contents/MacOS/MacNASMenu"
rm -rf -- "$TEMP_DIR/build"
cp "$INFO_PLIST" "$TEMP_DIR/Contents/Info.plist"
if [[ -f "$ROOT_DIR/desktop/src-tauri/icons/icon.icns" ]]; then
  cp "$ROOT_DIR/desktop/src-tauri/icons/icon.icns" "$TEMP_DIR/Contents/Resources/AppIcon.icns"
fi
chmod 0755 "$TEMP_DIR/Contents/MacOS/MacNASMenu"

rm -rf -- "$OUTPUT"
mkdir -p "$(dirname -- "$OUTPUT")"
mv "$TEMP_DIR" "$OUTPUT"
printf '[MacNAS] 菜单栏助手构建完成：%s\n' "$OUTPUT"
