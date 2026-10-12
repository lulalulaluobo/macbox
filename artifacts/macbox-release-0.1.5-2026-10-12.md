# MacBox v0.1.5 发布完成

2026-10-12 17:23（北京时间）已正式发布 [MacBox v0.1.5](https://github.com/lulalulaluobo/macbox/releases/tag/v0.1.5)，GitHub 最新版本接口返回 `v0.1.5`。Release 非草稿、非预发布，用户已确认文件夹上传修复正常。

## 源码与版本

- 修复代码、测试、README 和版本号已推送到 `origin/main`。
- 发布标签 `v0.1.5` 指向 [46a976d](https://github.com/lulalulaluobo/macbox/commit/46a976df78f5733e7fc4cc2c35d63283c68a7bc7)。
- 发行程序版本为 `0.1.5`，内嵌提交为 `46a976d`，Go 构建元数据 `vcs.modified=false`。
- 旧版本 Release 和资产保留。

## 下载与校验

- [Apple 芯片 DMG](https://github.com/lulalulaluobo/macbox/releases/download/v0.1.5/MacBox_0.1.5_macos_aarch64.dmg)
- [Intel DMG](https://github.com/lulalulaluobo/macbox/releases/download/v0.1.5/MacBox_0.1.5_macos_x86_64.dmg)
- [全部安装包与 SHA-256 校验文件](https://github.com/lulalulaluobo/macbox/releases/tag/v0.1.5)

同时提供两种架构的命令行压缩包，供命令行部署与设置页在线升级使用，共 8 个发布资产。GitHub 返回的每个资产的大小与 SHA-256 都已逐项核对，全部与本地文件一致。

| 安装包 | SHA-256 |
|---|---|
| MacBox_0.1.5_macos_aarch64.dmg | `c0bde46f4162a477825257ccf451b1e2b0d255011869995327cc79e383ce28ad` |
| MacBox_0.1.5_macos_aarch64.tar.gz | `11767a15dfea57aca7207d0725cefc45976be52562ed8da9785d35d76a1ac858` |
| MacBox_0.1.5_macos_x86_64.dmg | `c7b67e8beabacf8744f7ed0fe6da3df509c671348956037b7dc65605bb033554` |
| MacBox_0.1.5_macos_x86_64.tar.gz | `32c64db4392bbfcffd9168ec55d13410315d7bf7eca5cfb428bc3de0af2b4955` |

## 验证与更新内容

- 完整 Go 测试与静态检查、前端严格类型检查、生产构建、包大小检查及上传专项测试通过。
- 支持选择整个文件夹并保留根目录与子目录；电脑拖放支持空目录，读取超过 100 项的目录时不会遗漏后续批次。
- 失败提示包含具体路径和已完成数量，上传期间保护目标目录，后台拒绝路径穿越及越界符号链接。
- 本机修复版已经完成实际浏览器和运行虚拟机验证，用户确认正常。
- 两种架构 DMG 的磁盘、签名、版本、架构、内部 manifest 和 BUILD_ID 校验通过。
- 两种架构压缩包的安全成员清单、后端架构、菜单版本、版本/提交/构建时间、内部校验及 README 内容验证通过。
- 发行包从干净源码副本构建；打包流程已排除 Finder 元数据和 AppleDouble 文件，包内不含用户配置、虚拟机磁盘或私人资料。

安装包继续采用 ad-hoc 签名，未 Apple 公证。手机是否能选择目录取决于浏览器及系统文件选择器；按钮选择目录时浏览器不返回空目录，要保留空目录请使用电脑拖放。
