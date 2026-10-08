# MacBox v0.1.4 发布完成

用户已授权推送远程 Git 并更新 Release。2026-10-09 00:30（北京时间）发布 [MacBox v0.1.4](https://github.com/lulalulaluobo/macbox/releases/tag/v0.1.4)，目前为最新正式版本。

## Git 与版本

- 代码已推送到 `origin/main`。
- 标签 `v0.1.4` 指向提交 `76f53f089570c33c4763426fedbd997da2237dbd`。
- 正式安装包均标记版本 `0.1.4` 和提交 `76f53f0`，未标记本地修改。
- v0.1.3 和旧版发行文件保留。

## 发行文件

提供 Apple 芯片与 Intel 的 DMG、命令行压缩包，以及每个文件对应的 `.sha256`，共 8 个资产。已逐个核对 GitHub 返回的大小和 SHA-256，全部与本地一致。

| 安装包 | SHA-256 |
|---|---|
| Apple 芯片 DMG | `62c15356474f49515b3d84a7199a66bded1fd26c7bd07884da0abf1ad85b0ae0` |
| Apple 芯片 tar.gz | `6f2fb3f7468822c0cbbdf65caf797ff773cc7422e2e5c558b07f2f4ae887def4` |
| Intel DMG | `a4329699330ec7b03298a9db1f18acc699d76e666e37a998efdf4479c2fa731f` |
| Intel tar.gz | `89bba055ea4bf6ad6a8ddf201f36e5c3246ee97dce62111a9dfd245f184e0671` |

## 检查结果

- 完整 Go 测试、静态检查通过，使用发行包一致的 `CGO_ENABLED=0`。
- 前端构建与包大小检查通过。
- 两种架构的 DMG 签名、磁盘及内部校验通过。
- 两种架构的压缩包版本、提交、二进制架构和内部校验通过；包内不含账号、虚拟机数据和 Tailscale 设备凭据。
- 本机 Tailscale 设备已处于 Running，有私有地址，后台中转 active；运行系统通过私有地址打开后台返回 HTTP 200。
- 公开 Release 不是草稿或预发行版，最新版本接口返回 `v0.1.4`，标签指向正确提交。

安装包采用 ad-hoc 签名，未 Apple 公证。源码和发行文件包含 Tailscale 模块；真实跨外部网络访问继续受设备连接和用户网络规则控制。

可在“设置 → 版本更新”检查新版本，或从 [Release 页面](https://github.com/lulalulaluobo/macbox/releases/tag/v0.1.4) 下载与处理器对应的安装包。
