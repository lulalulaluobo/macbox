# MacNAS 产品优化与开源发布路线图

日期：2026-09-12  
审查对象：当前工作树（CLI Web 服务交付路线，Go + React + Lima + Docker Engine + Samba）  
目标：在不盲目扩大功能面的前提下，找出高价值、低投入、可持续维护并适合开源分发的下一阶段工作。

## 一、结论先行

MacNAS 当前最应该做的不是继续增加应用数量，而是把下面四件事做成稳定产品能力：

1. **首次启动可观察、可恢复**：用户必须知道现在是在检查、下载、创建 VM、启动 SSH、准备 Docker，还是已经失败；不能再出现“卡住几分钟后突然跳主页”。
2. **存储与挂载可解释、可诊断**：清楚区分 Mac 本地目录直通、Lima 管理盘、外接磁盘、Docker AppData 和应用下载目录，绑定失败时给出权限、路径、挂载状态和恢复动作。
3. **应用安装可验证、可回滚**：商城模板、镜像、端口、目录和权限都要有明确来源和健康检查，不能仅凭应用 ID 推断镜像，更不能让 `latest` 和未经验证的远程目录决定生产配置。
4. **数据可恢复**：至少先备份 MacNAS 配置、Compose、应用配置和挂载定义；随后再提供面向用户数据的加密增量备份。

我的建议是：**先冻结商城扩张，完成 P0 发布门槛；然后做备份、局域网发现和模板化应用治理；远程访问、复杂权限、RAID/ZFS、原生 Mac App 暂缓。** 这条路线最符合 MacNAS 的实际定位：一台 Mac mini 上的低门槛家庭 NAS/Docker 控制面，而不是重新做一个 CasaOS、TrueNAS 或 Docker Desktop。

## 二、当前产品基线

### 已经具备的基础

- 交付形态已经适合纯开源：预编译 Go 二进制、内嵌 React 前端、`install.sh`、`MacNAS.command`，不依赖 Node.js，也不要求 DMG 或 Apple Developer 资质。
- 后端已经按系统、VM、存储、Docker、应用、Samba、文件、认证拆分 handler；VM 启停和部分耗时操作已经使用后台 Job。
- 已有管理员鉴权、密码哈希、会话过期、登录限速、CORS/Origin 限制、上传限制、文件根目录约束、Compose 删除卷二次确认等安全基础。
- 已有 Lima 端口白名单和 Compose `ports` 解析，部署应用时尝试把端口转发到 Mac 局域网地址；Lima 官方本身也支持端口转发和目录挂载，这个技术方向成立。[Lima 端口转发文档](https://lima-vm.io/docs/config/port/)
- 应用模板已经从少量内置应用扩展到 Dockge、迅雷、百度网盘等，说明“模板化商城”是可行的，但当前治理能力还没有跟上扩展速度。

### 当前最重要的产品债务

1. **代码、文档和发行行为存在漂移**：整改文档称已经消除 `sh -c`，但当前 `pkg/docker/compose.go` 仍通过 `sh -c` 做 Compose 目录扫描；`README.md` 与认证实现对“固定 `admin/admin123`”的描述也需要统一。它们未必都会直接造成漏洞，但会破坏发布审计和用户信任。
2. **首次启动仍是“长任务黑盒”**：虽然已有 Job 和阶段 UI，但 VM 创建、启动、SSH、Docker/Samba 就绪之间还没有统一的可观测状态机、超时后的诊断包和恢复策略。
3. **应用商城的信任边界不清楚**：`pkg/apps/community.go` 会从外部 URL 读取目录；对部分条目还会根据 ID 推断镜像名并拼装 Compose。外部目录不是签名清单，`latest` 也不是可复现版本。
4. **Compose 的能力大于 MacNAS 的安全策略**：Compose 标准支持 `ports`、`volumes`、`healthcheck`、`cap_add`、`security_opt`、`privileged` 等大量字段。[Docker Compose services 官方文档](https://docs.docker.com/reference/compose-file/services/) 当前 MacNAS 主要验证 YAML、端口和部分文本字段，还没有形成明确的能力分级与危险项确认。
5. **纯 Web 的本地文件选择存在物理边界**：手机浏览器不能弹出 Mac 的原生文件夹选择器来让用户选择 Mac 上的目录；浏览器的文件选择通常只能把用户当前设备上的文件交给 Web。若要选择“运行 MacNAS 的 Mac 上的目录”，必须由 Mac 端 CLI、原生 helper 或受限的目录扫描 API 完成。继续把它设计成手机端路径输入框，会反复产生“直通不成功”的误解。

## 三、排序模型

评分采用 1–5 分：价值越高分越高；开发、维护、分发成本越高分越高。建议优先选择“价值高、三项成本低”的项目，而不是只看功能是否炫。

| 维度 | 判断标准 |
|---|---|
| 用户价值 | 是否直接减少首次失败、数据丢失、无法访问或无法恢复 |
| 开发成本 | 是否需要改 VM/存储/协议边界，是否有大量跨平台测试 |
| 维护成本 | 是否依赖第三方镜像、外部 API、系统版本或复杂状态机 |
| 分发成本 | 是否增加安装包体积、权限、签名、许可证和用户环境要求 |
| 开源复用 | 能否复用成熟项目的协议、模板或运行方式，而非复制大段代码 |

## 四、P0：发布前必须完成

### P0-1：统一的首次启动状态机与故障诊断中心

**价值：5/5；开发：中；维护：中；分发：低；建议顺序：第 1。**

把初始化明确建模为：

```text
检查 macOS / Lima
  → 创建或读取 VM
  → 启动 VM
  → 等待 SSH
  → 配置 root 密钥
  → 检查 Docker
  → 检查数据盘
  → 启动/检查 Samba
  → 完成
```

每一步都应有 `pending/running/succeeded/failed/cancelled`、开始时间、耗时、可重试动作、面向用户的短错误和管理员可展开的原始日志。建议增加：

- 单步硬超时与总超时；例如 VM 启动、SSH 等待、Docker 就绪分别计时。
- “正在下载 / 正在创建 / 正在等待服务”与“没有返回状态”分开显示。
- 失败后保留 Job 和日志，不因页面刷新丢失。
- “重新检查”“仅重试失败步骤”“重置 MacNAS 专属状态”三种操作，不默认删除用户数据。
- 一键复制诊断信息：MacNAS 版本、macOS 架构、Lima 版本、VM 状态、磁盘状态、最近 Job 错误；禁止包含密码、Cookie、私钥和完整环境变量。
- 首页永远显示一个简洁的 readiness 状态，而不是同时让 CPU、Docker、文件页各自猜测系统是否可用。

这是最便宜、收益最大的功能，因为它主要复用现有 Job，不引入新运行时。

### P0-2：存储健康检查与挂载契约

**价值：5/5；开发：中；维护：中；分发：低；建议顺序：第 2。**

需要将存储对象拆成四种类型，并在 UI/API 中使用不同名称：

1. Mac 本地目录直通：宿主机路径 → VM 内 guest 目标。
2. Lima 管理数据盘：Mac 上的 sparse image/managed disk → VM `/data`。
3. 外接 SSD 绑定：外接卷路径 → VM 数据目录或存储空间。
4. Docker 应用数据：`/data/appdata/<app>`，不应被误认为用户下载目录。

每个挂载记录应保存“期望状态”和“观测状态”：路径是否存在、是否为目录、Mac 是否已挂载、VM 是否已看到目标、读写模式、最后一次检查时间、失败原因。绑定之前做预检，绑定之后做验证：在 guest 目标目录创建临时探针、读取 Mac 目录中的已知文件数量，再删除探针。

对纯 Web 版本，推荐的低成本交互是：

- MacNAS 自动扫描 `$HOME/Downloads`、`Movies`、`Pictures` 和已挂载外接卷，用户只选择候选目录。
- 增加“刷新本机目录”和“使用 MacNAS CLI 选择目录”入口。
- 手机或其他局域网设备只能从候选目录中选择，不能声称可以弹出 Mac 原生文件夹选择器。
- 危险的任意路径输入只保留给本机管理员，并要求明确确认和权限检查。

这能解决用户此前的核心困惑，而且不需要重新引入完整原生 App。

### P0-3：应用商城供应链与 Compose 安全策略

**价值：5/5；开发：中；维护：中高；分发：低；建议顺序：第 3。**

当前商城扩张速度已经超过治理能力。正式发布前应做以下收口：

- 内置应用使用仓库中的 `app.json + compose.yaml`，每个模板声明维护者、主页、许可证、支持架构、默认端口、数据目录、健康检查、权限级别和最后验证时间。
- 不再从远程应用 ID 推断镜像名称；每个镜像必须显式列出完整地址。
- 不再将 `latest` 作为正式版本标识；至少固定到明确 tag，成熟后再增加 digest 锁定。
- 社区目录只提供“候选元数据”，不能直接获得执行权限；远程目录更新必须有版本、来源、校验和回滚。
- 对 `privileged`、`SYS_ADMIN`、`apparmor=unconfined`、宿主 Docker socket、宿主设备、任意宿主路径、host network、低端口和 VNC 端口显示高风险标签并二次确认。
- 部署前运行 `docker compose config`/等价解析，检查端口冲突、宿主目录、镜像架构和危险字段；部署失败时保留旧 Compose，不把半成功状态显示成“运行中”。
- 增加 `healthcheck` 和“容器运行”两层状态：容器活着不等于应用 Web 服务可用。Compose 的 `depends_on` 在使用 `service_healthy` 时可以等待依赖健康，这应纳入模板规范。[Docker Compose 依赖和健康检查说明](https://docs.docker.com/reference/compose-file/services/)

迅雷模板里的 `SYS_ADMIN` 和 `apparmor=unconfined` 可以作为明确的兼容性例外，但不能成为全商城默认策略。Docker 官方也建议保护 Docker daemon socket；将 socket 交给 Dockge/Portainer 类应用实际上等价于授予高权限管理能力。[Docker daemon socket 安全说明](https://docs.docker.com/engine/security/protect-access/)

### P0-4：安全与发布门槛重新验收

**价值：5/5；开发：低到中；维护：中；分发：低；建议顺序：第 4。**

对照上一份后端审查，安全整改不能只看旧文档上的“已完成”，应重新建立自动化发布门槛：

- 重新核对所有代码、脚本、模板、README 的默认账号、初始密码、Samba 密码和 root SSH 描述；用户要求的 `admin/admin123` 只能作为一次性初始化约定，初始化后必须强制改密或至少明确风险。
- 删除或替换 `pkg/docker/compose.go` 中遗留的 `sh -c`；目录扫描应改为固定参数调用或由 VM 内受控脚本完成，并补回归测试。
- 所有 Compose 模板通过安全规则测试；禁止未声明的宿主路径和隐式高权限。
- CI 固定 `go test -race ./...`、`go vet ./...`、前端构建、依赖漏洞扫描、模板校验和两种 macOS 架构构建。
- 发行包增加 SBOM、版本信息、SHA-256；后续再考虑签名，而不是现在为了签名引入 DMG 和 Apple Developer 成本。
- `references/` 最终移出根模块树；参考项目只保留链接、许可证和架构笔记，避免把参考源码、许可证和构建依赖混入正式交付边界。

## 五、P1：高价值、低到中成本功能

### P1-1：配置与应用数据备份/恢复

**价值：5/5；开发：中；维护：低到中；分发：低；建议顺序：第 5。**

先做“MacNAS 配置备份”，范围包括认证配置、VM 配置、存储绑定、直通目录、SMB 配置、Compose 文件和应用元数据，不立即复制几 TB 的用户媒体。备份包应加密、带版本、可在新实例恢复，并显示“将覆盖哪些配置”。

第二阶段再增加应用数据备份和定时策略。实现上优先调用成熟工具，而不是从零写去重备份：restic 采用 BSD-2-Clause，支持加密仓库和快照；Kopia 提供压缩、去重、端到端加密和策略/调度能力。[restic 官方项目](https://github.com/restic/restic)、[Kopia 官方文档](https://kopia.io/docs/)。

建议首选 restic 作为可选外部引擎：二进制小、许可证宽松、适合“本地外接盘/SMB/S3 目标”，MacNAS 只负责编排、凭据存储、任务状态和恢复确认，不复制备份引擎代码。

### P1-2：服务健康中心与日志包

**价值：5/5；开发：中；维护：中；分发：低；建议顺序：第 6。**

首页增加统一依赖图：MacNAS Web → Lima → SSH → Docker → 数据盘 → Samba → 应用。每个节点显示健康、延迟、最后成功时间和修复按钮。应用卡片显示“容器运行 / healthcheck healthy / Web 端口可达”三种状态。

提供“导出诊断包”而不是让用户截图。诊断包默认脱敏：不包含密码、Cookie、私钥、完整 Compose secret 和用户文件名；包含版本、配置摘要、Job 日志、Docker inspect 的非敏感字段、端口和磁盘检查结果。

### P1-3：局域网地址稳定化与服务目录

**价值：4/5；开发：低到中；维护：低；分发：低；建议顺序：第 7。**

当前用户需要记住 `192.168.x.x:19808`，而 DHCP 可能改变地址。Mac 端可以发布 `macnas.local` 或 `_http._tcp` 服务，并在页面提供本机地址、局域网地址、复制按钮和二维码。Bonjour 的目标就是在局域网自动发布、发现和解析服务。[Apple Bonjour 官方说明](https://developer.apple.com/bonjour/)

设计上必须保留 IP 兜底：部分路由器会隔离 mDNS，手机还可能需要允许局域网访问；Apple 对局域网访问本身也有隐私权限控制。[Apple 局域网权限说明](https://support.apple.com/en-us/102229)

同一能力还可以用于应用服务目录：显示应用名称、局域网 URL、端口、是否可达，而不是让用户自己拼接地址。

### P1-4：模板化资源档位和端口管理

**价值：4/5；开发：低；维护：低；分发：低；建议顺序：第 8。**

给 VM 和应用提供“轻量 / 标准 / 性能”档位，展示 CPU、内存、系统盘建议值和适用应用；对 Compose 提供可选 CPU/内存限制、日志大小上限和重启策略。Docker Compose 已定义 `cpus`、`mem_limit`、`pids_limit`、`logging` 等能力，可基于规范做白名单映射。[Docker Compose service 属性](https://docs.docker.com/reference/compose-file/services/)

端口管理应集中成一页：已占用、已转发、应用归属、局域网 URL、冲突原因。不要每次发现新端口都让用户猜 VM 是否重启；如果必须重启，应在 Job 中显示影响范围。

### P1-5：应用更新、备份后更新与回滚

**价值：4/5；开发：中；维护：高；分发：低；建议顺序：第 9。**

先支持“手动检查更新 → 展示变更 → 可选备份 → 拉取固定版本 → 重建 → 健康检查 → 失败回滚”。暂不做无人值守自动更新。

Dockge 的价值在于坚持使用标准 `compose.yaml`、提供堆栈级管理和实时反馈；MacNAS 可以复用这个思路，不必嵌入 Dockge 的完整运行时。[Dockge 官方项目](https://github.com/louislam/dockge)

## 六、P2：暂缓或仅做轻量入口

| 功能 | 判断 | 原因 |
|---|---|---|
| 远程访问、DDNS、HTTPS | 暂缓 | 会引入证书、身份、穿透、公网攻击面和大量客服问题；优先支持 Tailscale/反向代理的文档，不把远程访问做进核心。 |
| 多用户、用户组、细粒度 ACL | 暂缓 | SMB、Web、应用和 Linux 用户权限很容易不一致；先保持单管理员 + 单 SMB 用户，等权限模型稳定再做。 |
| RAID、ZFS、存储池、物理盘直通 | 暂缓 | 破坏性强、跨 macOS/Lima/文件系统问题多，与当前“外接盘 + Linux 数据层”路线冲突。 |
| 照片管理、在线预览、媒体刮削 | 以应用模板提供 | Jellyfin、Immich 等项目自身维护成本更合适，MacNAS 只提供稳定目录、权限和备份。 |
| 迅雷、百度网盘等闭源/社区镜像 | 社区模板，不进核心保证 | 镜像来源、登录流程、架构适配和高权限要求不受 MacNAS 控制；必须显示来源、风险和版本。 |
| 原生 DMG、签名、公证 | 暂缓 | 当前纯 Web + tar.gz 已降低分发成本；没有 Apple Developer 资质时，签名收益不足以抵消持续成本。 |
| 内置完整 Dockge/Portainer | 不做 | 与 MacNAS Compose 管理重叠，并增加 Docker socket 高权限面；参考交互和标准 Compose 即可。 |
| AI 管理、插件市场、任意第三方脚本 | 暂缓 | 对核心 NAS 没有直接收益，会扩大执行权限和供应链风险。 |

## 七、开源项目复用建议与许可证边界

| 项目 | 推荐用法 | 许可证/风险判断 |
|---|---|---|
| Lima | 继续作为 VM 底座，调用 `limactl`，不复制内部实现 | 官方文档和版本行为需锁定测试；Homebrew 安装降低包体积，但首次安装仍有外部依赖。 |
| CasaOS | 参考首页、存储、应用卡片和低门槛交互 | 仓库标注 Apache-2.0；只借鉴产品模式，避免复制品牌、资源和大段代码。[CasaOS 官方仓库](https://github.com/IceWhaleTech/CasaOS) |
| Dockge | 参考 Compose 堆栈目录、标准 YAML、实时日志和错误表达 | 仓库为 MIT；不建议把完整 Dockge 作为 MacNAS 核心依赖。[Dockge 官方仓库](https://github.com/louislam/dockge) |
| restic | 作为可选备份二进制 | BSD-2-Clause，适合分发和外部调用；仍要提供许可证、版本和校验信息。[restic 许可证](https://github.com/restic/restic/blob/master/LICENSE) |
| Kopia | 作为备选备份后端或高级模式 | 功能完整但体积、配置和维护面更大；第一版不同时支持两个备份引擎。[Kopia 文档](https://kopia.io/docs/) |
| Syncthing | 保留为应用模板 | MPLv2；它适合同步，不等于备份，UI 文案必须避免让用户把同步误认为灾备。[Syncthing 官方仓库](https://github.com/syncthing/syncthing) |
| SFTPGo | 仅在明确需要 SFTP/WebDAV/多用户文件服务时评估 | AGPLv3，且其 Web UI 主题有额外限制；不能直接复制 UI 到 MacNAS。可作为独立容器模板。[SFTPGo 官方仓库](https://github.com/drakkan/sftpgo) |

开源复用原则：**优先复用协议、标准格式、CLI 和运行方式；其次复用架构思想；最后才考虑复制代码。** 每个进入正式发行包的第三方组件都要登记版本、来源、许可证、变更方式和安全更新责任。

## 八、建议的 90 天实施顺序

### 第 1–2 周：发布阻塞清理

- 建立“代码/文档/模板/发行包”一致性检查。
- 移除遗留 shell 解释器调用，补回归测试。
- 初始化状态机补齐超时、重试、失败保持和诊断日志。
- 重新跑两架构构建、`go test -race`、`go vet`、前端构建和模板校验。

### 第 3–4 周：存储与网络可用性

- 建立挂载期望状态/观测状态。
- 增加本机目录候选扫描、Mac 端选择入口和挂载探针验证。
- 增加端口冲突诊断、应用 URL 目录和局域网地址复制。
- 评估 Bonjour 发布；保留 IP 访问兜底。

### 第 5–8 周：应用治理与恢复

- `app.json` 增加权限、架构、健康检查、许可证、固定镜像版本和风险字段。
- 社区目录改成签名/校验/版本化的元数据来源，禁止 ID 推断镜像。
- Compose 部署做 dry-run、危险字段确认、健康检查和失败回滚。
- 完成 MacNAS 配置备份/恢复；再接入 restic 的可选数据备份。

### 第 9–12 周：低风险增值

- 手动更新、备份后更新、健康检查失败回滚。
- VM/应用资源档位和日志轮转。
- 诊断包导出、匿名故障统计开关（默认关闭，不上传用户数据）。
- 发布文档、迁移文档、卸载文档和贡献者模板。

## 九、发布验收标准

在继续增加商城应用前，建议把以下指标作为 release gate：

1. 新用户从解压到打开 Web 页面，任何阶段最长等待都有明确倒计时或进度；失败可定位到具体步骤。
2. Lima 不存在、Homebrew 不存在、VM 已存在、VM 损坏、数据盘未挂载、端口冲突等场景都有不同提示和恢复动作。
3. 任一存储绑定操作失败不会丢失旧配置、旧镜像或旧挂载；成功后必须通过 guest 侧探针验证。
4. 任一应用安装都能看到来源、镜像、端口、目录、权限和健康状态；安装失败不留下“看似运行”的残留记录。
5. `latest`、未声明宿主路径、高权限字段和 Docker socket 都不会静默进入正式模板。
6. 配置可以导出并在干净实例恢复；恢复前明确列出覆盖范围。
7. 局域网访问既支持 IP，也提供稳定的服务发现/复制入口；不能把当前 DHCP 地址写死。
8. 发布包不包含用户的 Docker 容器、镜像、卷、Lima 实例、用户目录、开发机绝对路径和测试数据。
9. CI 能在临时 HOME、无真实 Lima/Docker 数据的环境重复执行安全回归测试。
10. 文档里的默认账号、安装方式、卸载范围与实际脚本和代码完全一致。

## 十、最终建议

### 现在就做

1. 首次启动状态机和诊断中心。
2. 存储挂载契约、探针验证和本机目录候选扫描。
3. 应用模板供应链治理和 Compose 危险字段策略。
4. 重新验收安全基线与发布包一致性。
5. 配置备份/恢复。

### 之后做

6. 健康中心、日志包和局域网服务目录。
7. Bonjour/mDNS + IP 兜底。
8. 资源档位、端口管理和手动更新回滚。

### 不要被功能数量带偏

迅雷、百度网盘、更多媒体应用会让商城看起来丰富，但它们不会解决 MacNAS 当前最关键的“第一次能否稳定跑起来、磁盘是否真的可用、应用是否真的可访问、数据出了问题能否恢复”。对开源项目来说，**稳定的底座、清楚的诊断和可恢复的数据，比再增加几十个 Compose 模板更能形成口碑和贡献者生态。**

## 十一、参考资料

- [Lima 官方文档：端口转发](https://lima-vm.io/docs/config/port/)
- [Lima 官方文档：配置与挂载](https://lima-vm.io/docs/config/)
- [Docker Compose 官方 services 规范](https://docs.docker.com/reference/compose-file/services/)
- [Docker 官方：保护 Docker daemon socket](https://docs.docker.com/engine/security/protect-access/)
- [Apple Developer：Bonjour](https://developer.apple.com/bonjour/)
- [Apple Support：局域网权限](https://support.apple.com/en-us/102229)
- [CasaOS 官方仓库](https://github.com/IceWhaleTech/CasaOS)
- [Dockge 官方仓库](https://github.com/louislam/dockge)
- [restic 官方仓库与许可证](https://github.com/restic/restic)
- [Kopia 官方文档](https://kopia.io/docs/)
- [Syncthing 官方仓库](https://github.com/syncthing/syncthing)
- [SFTPGo 官方仓库](https://github.com/drakkan/sftpgo)

