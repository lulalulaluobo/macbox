#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
desktop_root="$project_root/desktop"
sidecar_dir="$desktop_root/src-tauri/binaries"

cd "$project_root"
npm --prefix web run build
mkdir -p "$sidecar_dir"

host_arch="$(uname -m)"
case "$host_arch" in
  arm64) sidecar_name="macnas-aarch64-apple-darwin"; go_arch="arm64"; rust_target="aarch64_apple_darwin" ;;
  x86_64) sidecar_name="macnas-x86_64-apple-darwin"; go_arch="amd64"; rust_target="x86_64_apple_darwin" ;;
  *) echo "不支持的 macOS 架构: $host_arch" >&2; exit 1 ;;
esac

echo "==> 编译 MacNAS Go sidecar ($host_arch)"
CGO_ENABLED=0 GOOS=darwin GOARCH="$go_arch" \
  go build -trimpath -ldflags="-s -w" -o "$sidecar_dir/$sidecar_name" ./cmd/macnas

echo "==> 构建 MacNAS.dmg"
cd "$desktop_root"
rust_target_upper="$(printf '%s' "$rust_target" | tr '[:lower:]' '[:upper:]')"
linker_variable="CARGO_TARGET_${rust_target_upper}_LINKER"
export CC=/usr/bin/clang CXX=/usr/bin/clang++
export "$linker_variable=/usr/bin/clang"
npx tauri build --bundles dmg

echo "==> 交付物"
find "$desktop_root/src-tauri/target" -type f -name 'MacNAS*.dmg' -print
