# Tailscale 远程访问：本机测试版 0.1.4

已增加模块并重新打包部署本机。入口为 **设置 → 远程访问**，后台地址为 [打开 MacBox](http://127.0.0.1:19808/)。

## 使用方式

1. 登录 MacBox，进入“设置 → 远程访问”。
2. 首次使用点击“开启访问”，自动安装官方客户端。
3. 点击“登录账号”，在 Tailscale 官方页面授权这台设备。
4. 如显示“等待批准”，点击“批准设备”，在官方后台批准。
5. 访问用的手机或电脑也连接同一 Tailscale 网络，再使用页面中的后台或应用入口。

本机已经安装客户端并准备好官方授权。真实账号授权尚待用户完成；当前尚未取得远程 IP，未宣称已完成真实外网连通验证。

## 已实现

- 官方设备授权链接；不收集 Tailscale 账号密码或要求填写 Auth Key。
- 尚未开启、等待登录、等待批准、连接中、已连接、暂停、过期状态。
- 设备名称、所属网络、远程 IP，以及可复制和打开的后台、应用入口。
- 填写其他服务的端口，即可生成访问地址；这只生成链接。
- 暂停保留登录；退出需要重新授权。两种操作都提前提示连接会断开。
- 从远程入口打开后台时，应用和运行系统服务的导航地址随访问地址调整。
- 页面刷新后恢复后台任务显示；重复操作互斥，安装期间阻止系统重启和版本切换。
- 设备凭据留在 Linux 的 `/var/lib/tailscale`，MacBox 更新保留运行系统磁盘和应用数据。

## 实现与访问边界

客户端位于 Linux 运行系统，不修改 Mac 上已有的 Tailscale。Ubuntu 24.04 使用官方签名软件源安装；未执行下载的安装脚本。只有首次安装客户端时设置设备名称，并关闭接收网络 DNS 与其他设备的路由。

读取状态使用官方 CLI；连接和重新授权使用守护进程的本地接口，仅通过 Linux 的 Unix 套接字调用。恢复仅修改连接开关，不重置已有网络偏好。本地接口的响应在 Linux 内丢弃，设备密钥和授权链接不会写入 MacBox 任务记录、日志、配置导出或安装包。

MacBox 后台位于 Mac，应用位于 Linux。后台采用固定目的地的专用中转，仅监听本设备的 Tailscale IP，由 systemd 管理，以临时低权限身份运行。用户无需配置转发规则；原服务发布和端口转发页面未恢复。HTTP 私有入口在设备间经过 Tailscale 加密，后台继续使用原来的 MacBox 登录、Host、Origin 和终端权限检查。

默认提供私有访问。访问权限继续由用户的 Tailscale 网络规则决定；未开启公开 Funnel、家庭网段路由或出口节点。Mac 和运行系统需要保持开启；命令安装的服务需允许其他设备连接。

依据：[官方安装源](https://pkgs.tailscale.com/stable/)、[官方 CLI](https://tailscale.com/docs/reference/tailscale-cli)、[官方本地接口实现](https://github.com/tailscale/tailscale/blob/main/ipn/localapi/localapi.go)。官方源码已按项目规则保存在忽略目录 `references/tailscale`，未引入额外 Go 或前端依赖。

## 验证结果

| 检查 | 结果 |
|---|---|
| 完整 Go 测试、静态检查 | 通过，采用发行包一致的 `CGO_ENABLED=0` |
| 前端构建和包大小检查 | 通过 |
| 状态、链接校验、偏好保留、权限和操作互斥 | 通过 |
| 界面自动测试 | 安装去重、授权、待批准、入口、暂停确认、过期及小屏布局通过 |
| 官方客户端安装及授权准备 | 通过，客户端 1.104.1 |
| 全新内存客户端的授权准备 | 通过，测试实例已自动回收 |
| systemd 服务定义验证 | 通过 |
| 相同低权限限制下的后台 TCP 中转 | 页面 200；未登录 API/终端 401；外部来源 403；未许可 Host 421 |
| DMG 签名、磁盘校验、部署后健康检查 | 通过，当前运行 0.1.4 |
| 部署后数据保留 | 4 个账号/设置文件及 Tailscale 状态文件校验值一致，容器 ID 87ad29a146b2 保留 |
| 原应用访问 | HTTP 200 |
| 真实账号授权及外网连接 | 待用户授权与测试 |

界面测试使用模拟账号和地址，截图位于 [桌面界面](/Users/luluen/ai-project/mac-nas/artifacts/tailscale-settings-desktop.png) 和 [手机界面](/Users/luluen/ai-project/mac-nas/artifacts/tailscale-settings-mobile.png)。

## 本机交付

- [Apple 芯片测试安装包](/Users/luluen/ai-project/mac-nas/dist/MacBox_0.1.4_macos_aarch64.dmg)，SHA-256：`2c2e47f165a43f7984342f54bc5e335385dc81c6166383605a15ab9fd00a4ff1`。
- 安装位置：`/Applications/MacBoxMemu.app`，运行组件：`~/.local/share/macbox`。
- 源码已纳入本地 Git；本次模块先供本机测试，未推送或发布新 Release。
- 安装包采用 ad-hoc 签名，未 Apple 公证。升级前程序与运行组件备份位于 `tmp/macbox-before-tailscale.app` 和 `tmp/macbox-runtime-before-tailscale`。
