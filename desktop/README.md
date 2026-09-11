# MacNAS macOS 交付版

该目录是基于 Tauri 的 Mac 启动器。它将 Go 后端作为 sidecar 一起打包，启动时执行健康检查，再打开本机控制台；如果用户已经通过 LaunchAgent 启动后端，则会复用已验证的 MacNAS 服务。

## 构建 DMG

在 macOS 上执行：

```bash
bash scripts/build-mac-dmg.sh
```

产物位于 `desktop/src-tauri/target/release/bundle/dmg/`。

当前脚本按照构建机架构生成 sidecar。正式发布 Universal 版本时，需要同时准备 Apple Silicon 与 Intel sidecar，并使用 Universal Tauri target 构建。
