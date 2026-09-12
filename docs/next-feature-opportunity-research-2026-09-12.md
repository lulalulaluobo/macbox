# MacNAS 下一阶段高价值功能评估

审查日期：2026-09-12  
审查对象：当前工作树，MacNAS CLI Web 服务交付路线（Go + React + Lima + Docker Engine + Samba）

## 结论先行

MacNAS 现在最值得继续做的，不是再增加一批应用，而是把“安装成功、运行可见、故障可定位、配置可恢复”做成闭环。这个方向同时满足四个条件：需求普遍、能复用当前代码、不会明显扩大分发体积、还能直接减少后续支持成本。

我建议下一阶段按下面的顺序开发：

1. **MacNAS Guard：健康与恢复中心**——统一显示虚拟机、Docker、存储、挂载、SMB、应用和后台任务状态，并提供重试、修复提示和脱敏诊断包。
2. **存储安全护栏**——低空间、挂载失效、写入探针、端口/路径冲突和重启影响提示；先不碰 RAID、ZFS、SMART。
3. **配置快照与导入恢复**——恢复配置、Compose、挂载声明和应用清单，不把它冒充成用户数据备份。
4. **可信应用安装层**——Compose 预检、架构检查、权限风险提示、健康检查和版本/来源元数据。
5. **可选的加密数据备份**——优先接入 restic，先做本地目录/另一块磁盘/SMB 目标和恢复验证。
6. **局域网服务目录**——Bonjour/mDNS、稳定服务链接、二维码和 IP 兜底。

如果只能选一个下一步，我会选 **MacNAS Guard**。如果可以连续做三个小版本，我会做“Guard → 配置恢复 → 可信应用安装”。这是最有机会形成 MacNAS 核心竞争力的低投入路线：用户不需要理解 Lima、端口转发或 Compose，就能知道系统现在是否可用、出问题该怎么处理、重装后能否回来。

## 评估方法与判断边界

这里的“需求”不是单纯按 GitHub issue 数量排序，而是按 NAS 产品的共同损失排序：数据不可恢复、服务安装失败、重启后找不到数据、局域网内找不到服务、升级后无法回滚。开源项目的 issue、官方文档和生态成熟度只作为需求信号；没有用户访谈支撑的判断，我会明确标为推断。

综合优先级使用一个简单模型：

`需求价值 × 40% + (低开发成本) × 25% + (低维护成本) × 20% + (低分发成本) × 15%`

安全、数据丢失和供应链风险属于硬门槛，不允许用高分抵消。例如“自动更新所有应用”看起来需求很高，但在没有备份、健康检查和回滚前，不应进入默认功能。

成本等级按单人维护估算：

- 低：2–5 个工作日，可主要复用现有后端和前端。
- 中：1–3 周，需要新的状态模型、外部工具或较多异常路径。
- 高：超过 3 周，或会引入内核/网络/磁盘兼容性、账户体系或长期版本矩阵。

## 当前项目已经具备的可复用基础

这不是从空项目开始，当前代码已经覆盖了候选功能的大部分底座：

- `pkg/api/handlers_diagnostics.go` 已有只读诊断接口，能检查 `limactl`、虚拟机、数据盘、Docker 和本机目录直通。
- `pkg/api/jobs.go` 已有持久化后台任务、阶段进度、取消和服务重启后的失败恢复标记。
- 存储层已有本机目录候选扫描、Lima 挂载配置以及 guest 侧探针；缺少的是统一展示、阈值策略和可执行修复动作。
- `pkg/config/config.go` 已有原子配置更新、虚拟机参数、转发端口、存储、SMB 和本机挂载配置。
- 应用安装、Compose 编辑、应用日志、端口转发和应用目录已经存在，适合在安装入口增加预检，而不是另做一套管理器。
- `pkg/system/service.go` 已有 LaunchAgent 自动启动；因此“开机启动”不是下一阶段的高价值新功能。

当前验证基线：`CGO_ENABLED=0 go test ./...` 通过，`web/` 下的 `npm run build` 通过。普通 cgo 测试受本机 Go/cgo 工具链环境影响失败，这属于开发环境问题，不应被误判成产品功能缺口。

## 候选功能排序

| 顺序 | 功能 | 需求 | 开发 | 维护 | 分发 | 首个可用版本 | 判断 |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | MacNAS Guard：健康、任务、诊断与恢复中心 | 高 | 低 | 低 | 低 | 3–7 天 | **立即做** |
| 2 | 存储安全护栏：空间、挂载、写入和冲突检查 | 高 | 低 | 低 | 低 | 3–5 天 | **立即做** |
| 3 | 配置快照、导入、差异预览与回滚 | 高 | 低 | 低 | 低 | 3–6 天 | **立即做** |
| 4 | 可信应用安装：Compose 预检、健康检查、风险标签 | 高 | 中 | 中 | 低 | 1–2 周 | **紧接着做** |
| 5 | 资源护栏：应用档位、内存/CPU/日志和端口预算 | 中高 | 低 | 低 | 低 | 3–5 天 | 可并入 4 |
| 6 | 加密数据备份与恢复演练 | 高 | 中 | 中 | 低中 | 1–2 周 | 第二阶段做 |
| 7 | Bonjour 服务目录、稳定链接和二维码 | 中高 | 低 | 低中 | 低中 | 2–4 天 | 体验型 P1 |
| 8 | 通用 Webhook 告警与站内注意事项 | 中高 | 低中 | 中 | 低 | 3–5 天 | 有健康中心后做 |
| 9 | TOTP 双因素认证 | 中高 | 中 | 中 | 低 | 3–7 天 | 远程访问前做 |
| 10 | 应用手动更新、预检、备份和回滚 | 高 | 高 | 高 | 低 | 2–4 周 | 暂缓，依赖 3/4/6 |

下面展开说明前六项，以及为什么它们的顺序不是按“看起来最酷”排列。

## 1. MacNAS Guard：健康与恢复中心

### 用户得到什么

用户打开首页就能看到：虚拟机是否运行、Docker 是否就绪、数据盘是否可用、本机直通目录是否健康、SMB 是否可访问、应用容器是否运行、后台任务是否卡住。每个异常必须有“原因、影响、下一步”，而不是只有一条失败字符串。

长任务要显示阶段、耗时、最后更新时间和可重试动作；失败时可以导出脱敏诊断包，包含版本、配置摘要、状态、最近日志和失败阶段，但不包含密码、Token、SMB 凭据或完整用户路径中的敏感信息。

### 为什么值得做

OpenMediaVault 的管理文档把通知、监控、SMART、计划任务和服务发现列为常规管理面，说明 NAS 的持续可见性不是附加玩具，而是基础能力。[OpenMediaVault administration](https://docs.openmediavault.org/en/latest/administration/) 也把通知事件延伸到挂载点、文件系统使用率、CPU/内存、计划任务和 SMART，这与 MacNAS 的主要故障边界高度重合。

CasaOS 的公开讨论显示，项目进入维护阶段后，问题积压会显著影响体验。[CasaOS maintenance discussion](https://github.com/IceWhaleTech/CasaOS/discussions/2386) 给出的反面教训是：功能越多，越需要一个能把问题讲清楚的支持和诊断面。对 MacNAS 来说，这部分应在继续扩张前完成。

### 复用与实现边界

已有诊断接口、任务持久化、VM/挂载探针都可以直接复用。首版不做远程监控平台、不做复杂指标数据库、不接入几十种通知渠道，只做：

1. 一个统一的健康摘要接口和前端面板。
2. 诊断项的 `pass / warn / fail / unknown` 状态、影响和修复建议。
3. 对已有可重试操作的重试入口。
4. 一份脱敏文本或 JSON 诊断包。

这是当前投入产出比最高的功能，因为它同时降低用户故障成本和开发者支持成本。

## 2. 存储安全护栏

### 建议做的范围

- 数据盘不存在、未挂载、挂载点变化时明确报警。
- 本机目录直通逐项显示“期望路径、guest 目标、当前探针结果、检查时间”。
- 安装应用或创建 Compose 前，检查目标路径、可用空间、端口冲突和目录可写性。
- 增加低空间阈值：警告阈值默认保守，临界时阻止高风险写入操作，但允许用户明确覆盖。
- 对会重启 Lima 或影响现有服务的动作提前提示，并显示受影响的端口和应用。
- 提供重新探测、重新加载挂载配置、重启虚拟机等有限且可解释的修复动作。

Lima 官方文档明确区分 guest/host 挂载和端口转发行为；MacNAS 的数据可靠性正好跨越这两层边界。[Lima mount configuration](https://lima-vm.io/docs/config/mount/) 与 [Lima port forwarding](https://lima-vm.io/docs/config/port/) 都说明了这类配置不是普通 Linux 本地路径映射，必须在 UI 中可观察。

### 明确不做

首版不做物理磁盘直通、RAID、ZFS、SMART 全套管理。OpenMediaVault 的 SMART 文档也提示，虚拟块设备可能无法正常提供 SMART 信息，RAID 场景还依赖硬件/设备直通。[OpenMediaVault SMART](https://docs.openmediavault.org/en/stable/administration/storage/smart.html) 是很好的需求参考，但不是 MacNAS 在 Lima 内直接复制的实现方案。

## 3. 配置快照、导入与恢复

这是“低成本但能明显提高信任度”的功能，且必须和数据备份明确分开。

### 首版应包含

- 导出 MacNAS 配置版本、VM 参数、转发端口、存储声明、SMB 声明、应用元数据和 Compose 文件。
- 默认不导出明文密码、Session、Token；可选用用户输入的口令加密敏感字段。
- 导入前做 schema 版本检查、路径/端口冲突检查和差异预览。
- 导入前自动保存当前配置；导入失败自动回到导入前版本。
- 支持“只恢复配置/应用清单”，不自动覆盖用户媒体目录。
- 通过 CLI 提供非 UI 恢复入口，避免 Web 页面损坏时完全失去控制。

首版不需要引入数据库、不需要云账号、不需要新的常驻服务。Go 标准库就可以完成归档、校验、原子替换和版本化。它解决的是“换机器、误改配置、重装 MacNAS 后快速回来”，不能声称解决磁盘损坏或勒索软件。

CISA 对备份的基本建议是 3-2-1：至少三份副本、两种介质、一份异地。[CISA Data Backup Options](https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf) 支持了把配置恢复和真正的数据备份分成两个阶段：先用几天完成低成本配置恢复，再做带验证的异地/异介质备份。

## 4. 可信应用安装层

当前应用目录最大的风险不是“应用太少”，而是来源、镜像、架构、权限和升级语义不够透明。当前代码中社区目录会同步外部目录，部分镜像信息还会按应用 ID 推断，多个模板使用可变的 `latest` 标签；这会放大安装失败和供应链问题。

### 首版应增加的应用元数据

建议将应用清单扩展为一个小而稳定的 manifest：

`id / version / architectures / image / digest / source / homepage / repository / license / support / dataPaths / ports / healthcheck / resourceProfile / capabilities / updatePolicy / verifiedAt / manifestHash`

不要求一次填满所有字段，但安装页至少应该显示来源、版本、支持架构、数据目录、暴露端口、健康检查、是否需要高权限、是否访问 Docker socket，以及升级策略。

### 安装前后流程

1. 静态清单校验：字段、版本、架构、镜像格式和内容哈希。
2. 端口、目录、架构、资源和权限预检。
3. 执行 `docker compose config -q`，先验证 Compose 解析结果，再允许部署。
4. 使用健康检查或有限超时确认服务真的启动，而不是只确认 `docker compose up` 返回成功。
5. 将实际部署的 Compose、镜像标签/摘要、清单版本和日志入口保存到应用记录。
6. 对 `privileged`、`cap_add`、`security_opt`、Docker socket 等能力显示高风险确认。

Docker 官方文档说明，`docker compose config -q` 可只做配置校验，`--resolve-image-digests` 和 `--lock-image-digests` 可把可变标签解析为摘要；Compose 也原生支持 `healthcheck`、依赖条件、资源限制、日志配置和重启策略。[Compose config](https://docs.docker.com/reference/cli/docker/compose/config/)、[Compose services](https://docs.docker.com/reference/compose-file/services/) 和 [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/) 足以支撑 MacNAS 的首版实现。

### 开源参考与取舍

CasaOS 的 AppStore 规范采用 Compose 加 `x-casaos` 元数据，并要求 Compose 通过 `docker compose config -q`；它还把架构、版本、更新日期、仓库、支持和文档作为目录推荐字段。[CasaOS Compose and x-casaos spec](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/compose-and-x-casaos.md) 和 [build output spec](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/build-output.md) 很适合借鉴“静态清单 + 内容哈希 + 可发布到 GitHub Pages/Cloudflare Pages”的分发思路。

建议参考规范和字段，不直接依赖 CasaOS 的运行时。这样 MacNAS 仍然能保持自己的 Lima/路径/端口模型，也不会把外部目录实时拉取变成启动链路的一部分。

Docker 官方明确警告，能够控制 Docker socket/daemon 的用户具有非常强的能力，Web 服务不应随意暴露或透传 Docker socket。[Protect the Docker daemon socket](https://docs.docker.com/engine/security/protect-access/) 因此 Dockge、Portainer、Dozzle、Homepage 等需要 socket 的应用应标为高风险可选项，不应成为 MacNAS 默认架构的一部分。

## 5. 加密数据备份与恢复演练

这是高需求功能，但不是最先做的原因是：它涉及数据选择、调度、凭据、锁、失败重试、空间不足、恢复验证和分发二进制，维护成本高于配置快照。

### 推荐方案

首选 **restic** 作为可选外部备份引擎，MacNAS 只负责目录选择、任务调度、保留策略、结果展示和恢复入口。restic 提供加密仓库、增量快照、检查和恢复能力，并有官方文档和多平台发布物。[restic repository](https://github.com/restic/restic) 与 [restic documentation](https://restic.readthedocs.io/en/stable/) 可作为实现基线。

首版目标限定为：

- MacNAS 配置和应用 Compose/数据目录。
- 目标是另一块本地磁盘、SMB 目录或用户明确指定的文件系统路径。
- 支持计划任务、保留策略、仓库检查、抽样恢复或完整恢复演练。
- 明确展示“最后一次成功备份”和“最后一次成功恢复验证”。

先不要同时支持 restic、Kopia、S3、WebDAV、各家云盘和自建远端协议。Kopia 也很优秀，提供加密、压缩、去重、校验、计划和 GUI 能力，[Kopia features](https://kopia.io/docs/features/) 可作为备选；但同时支持两个引擎会把问题翻倍。我的选择是：**简单 CLI 备份选 restic；如果未来需要更重的策略/维护 UI，再评估 Kopia**。

分发上有两个可行模式：

- 首版要求系统已有 `restic`，MacNAS 提供检查和安装指引，分发最轻。
- 产品化后按 arm64/amd64 固定版本随发行包提供，记录版本和校验值，分发成本略增但体验更好。

不建议把“Syncthing 已安装”当成备份能力。同步解决的是多端传播，不等于不可变历史、误删恢复或异地副本。

## 6. Bonjour 服务目录、稳定链接与二维码

MacNAS 当前会面对端口转发和局域网 IP 变化；用户真正想要的是“点开 Jellyfin”，而不是记住某台 Mac 的当前 IP 和端口。

首版可以很小：

- 在启用 LAN 监听时发布 MacNAS 的 `.local` 服务名。
- 首页显示 MacNAS 地址、应用地址、复制按钮和二维码。
- IP、端口和 `.local` 地址同时展示，`.local` 失败时不影响 IP 访问。
- 不做公网 DNS、DDNS、证书签发和反向代理。

Apple 将 Bonjour 定义为局域网内自动发现、发布和解析服务的零配置机制。[Apple Bonjour](https://developer.apple.com/bonjour/) 支持这一方向；但 macOS 的本地网络隐私需要注意，[TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy?changes=__3) 说明了不同进程形态对本地网络访问的差异。因此首版应把 IP 作为可靠兜底，不应把服务发现做成启动成功的前置条件。

实现上优先考虑调用 macOS 内置 `dns-sd` 或使用很小的 mDNS 库；不引入原生 App，不为了一个地址功能改变当前 tar.gz + CLI + LaunchAgent 分发形态。

## 7. 值得做但要排在后面的功能

### 资源护栏

把应用分为低/中/高资源档位，安装前显示预计内存和 CPU 影响，并统一设置日志滚动、`restart: unless-stopped`、内存/CPU 上限和进程数上限。Docker Compose 原生支持这些字段，投入很小，特别适合 Mac mini 这类资源有限的设备。[Compose services](https://docs.docker.com/reference/compose-file/services/) 已提供实现依据。它可作为“可信应用安装层”的一部分，不必单独开大项目。

### 通用 Webhook 与站内告警

不要一开始集成 Telegram、Discord、Slack、邮件、Gotify、Pushover 等几十种服务。Uptime Kuma 的项目页展示了这类通知矩阵的价值，也展示了其复杂度：支持大量监控协议和通知方式意味着大量边界条件。[Uptime Kuma](https://github.com/louislam/uptime-kuma) 适合让用户作为独立应用安装，而不是 MacNAS 再实现一遍。

MacNAS 首版只需抽象事件：磁盘空间低、挂载失效、VM/Docker 不可用、应用健康检查失败、备份失败；先提供站内注意事项和一个通用 Webhook，后续再增加具体渠道。

### TOTP 双因素认证

当前认证已有用户、密码、bcrypt、Session 和限流，但没有 MFA。若未来默认开放 LAN 或支持公网/远程访问，TOTP 应在远程访问之前完成。Go 的 [`pquerna/otp`](https://github.com/pquerna/otp) 可以降低实现成本，但真正的维护工作在恢复码、丢失设备、全会话失效、时钟偏差、管理员锁定和迁移，而不是生成二维码本身。

因此它是“安全前置条件”，不是当前第一优先级的增长功能。CasaOS 和 OpenMediaVault 社区都持续出现原生 2FA 请求，例如 [CasaOS 2FA issue](https://github.com/IceWhaleTech/CasaOS/issues/1944) 和 [OpenMediaVault TOTP issue](https://github.com/openmediavault/openmediavault/issues/2200)，说明需求真实存在；只是 MacNAS 在远程访问尚未成为核心之前，先做恢复和边界控制更划算。

## 不建议现在做的方向

| 方向 | 暂缓原因 | 当前替代方案 |
|---|---|---|
| 继续扩充几十个应用模板 | 每个模板都带来镜像、架构、权限、升级和用户支持成本；社区目录还会把供应链问题放大 | 冻结数量，先完善 manifest、预检和维护者责任字段 |
| 原生远程访问、DDNS、HTTPS、穿透 | 账户、证书、ACL、暴露面和售后责任都会显著增加 | 文档化 Tailscale 使用，MacNAS 只检测/展示连接状态，不打包守护进程 |
| RAID/ZFS/物理磁盘管理/完整 SMART | Lima 虚拟化边界、设备直通、睡眠唤醒和数据安全风险高 | 先做挂载、空间、写入探针和备份验证 |
| 集成完整 Dockge/Portainer | 与现有 Compose 页面重叠，Docker socket 权限过大，版本矩阵持续变化 | 保留 MacNAS 的最小 Compose 能力，提供外部工具链接 |
| 无人值守自动更新 | 没有数据备份、镜像摘要、健康检查和回滚时，失败代价不可控 | 先做手动更新预览；更新依赖 3/4/5 完成 |
| AI 运维、插件市场、复杂自动化 | 需求不如可靠性直接，提示错误会造成数据和服务操作风险 | 先让诊断结果结构化，未来再在结构化信息上做辅助解释 |

Tailscale 很适合用户自行解决远程访问；其文档区分 tailnet 内共享和公开 Funnel，公开访问还涉及 HTTPS、策略和限制。[Tailscale sharing](https://tailscale.com/kb/1354/share) 与 [Funnel](https://tailscale.com/kb/1223/funnel) 说明了为什么 MacNAS 应先做“可选集成/指引”，而不是把远程暴露能力内置进核心产品。

Dockge 是很好的 Compose 管理器参考，项目本身聚焦 stack 管理；但其公开 issue 也能看到 Docker API 兼容、YAML 特殊标签和自更新等长期维护问题。[Dockge repository](https://github.com/louislam/dockge)、[Docker API mismatch issue](https://github.com/louislam/dockge/issues/935) 和 [YAML tag issue](https://github.com/louislam/dockge/issues/448) 说明，复用交互思路比直接嵌入完整项目更稳妥。

## 推荐开发路线

### 第一个小版本：可恢复性闭环

把第 1–3 项合并成一个用户能感知的版本，目标不是增加页面，而是让每个关键动作都有状态和退路：

1. 首页健康摘要：VM、Docker、数据盘、挂载、SMB、应用、任务。
2. 统一状态模型：通过、警告、失败、未知，以及影响和修复建议。
3. 低空间/挂载失效/端口冲突预检。
4. 任务阶段、超时、失败重试和脱敏诊断包。
5. 配置导出、导入前差异预览、自动备份当前配置和失败回滚。

验收标准：一个新用户可以在首次启动、重启虚拟机、拔掉/改名挂载目录、端口冲突、Docker 未就绪这几类场景中，看到明确原因并得到下一步动作；开发者拿到诊断包后不需要用户手工复制五段日志。

### 第二个小版本：可信应用体验

做 manifest、静态目录、Compose 预检、健康检查、资源档位和风险标签。应用数量先不增长，先把已有模板全部补齐来源、镜像、架构、数据路径和维护状态。远程社区目录同步必须变成可追溯、可缓存、可拒绝的输入，不能继续依赖“按 ID 推断镜像”。

### 第三个小版本：备份与局域网体验

先加入 restic 的配置/应用数据备份和恢复验证，再加入 Bonjour、二维码和通用 Webhook。这样服务发现和告警建立在真实的健康状态之上，而不是单纯增加入口。

### 更长期：安全与更新

当远程访问成为明确产品方向时，先做 TOTP 和会话管理，再做手动更新预览、镜像摘要、备份前置、健康确认和有限回滚。只有在这些基础完成后，才值得评估自动更新。

## 最终建议

MacNAS 的下一阶段产品定位应从“macOS 上能管理 Docker 的 NAS 面板”推进到：

> **macOS 上一个可观察、可恢复、可验证的个人服务主机。**

这条路线的关键不是功能最多，而是每一个新增功能都必须回答三个问题：

1. 失败时用户能不能知道哪里错了？
2. 误操作或升级后能不能回来？
3. 这个功能会不会把新的长期维护面藏进发行包？

按照这个标准，当前最适合继续开发的是 **MacNAS Guard + 存储护栏 + 配置恢复**；最值得随后投资的是 **可信应用安装层**；最该延后的，是 **更多应用、远程暴露、RAID/ZFS 和无人值守升级**。

## 资料来源

### 产品与 NAS 生态

- [CasaOS repository](https://github.com/IceWhaleTech/CasaOS)
- [CasaOS maintenance discussion](https://github.com/IceWhaleTech/CasaOS/discussions/2386)
- [CasaOS AppStore Compose metadata specification](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/compose-and-x-casaos.md)
- [CasaOS AppStore build output specification](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/build-output.md)
- [OpenMediaVault administration](https://docs.openmediavault.org/en/latest/administration/)
- [OpenMediaVault notifications](https://docs.openmediavault.org/en/8.x/administration/general/notifications.html)
- [OpenMediaVault scheduled jobs](https://docs.openmediavault.org/en/8.x/administration/general/cron.html)
- [OpenMediaVault SMART](https://docs.openmediavault.org/en/stable/administration/storage/smart.html)

### 实现与安全

- [Docker Compose config](https://docs.docker.com/reference/cli/docker/compose/config/)
- [Docker Compose services](https://docs.docker.com/reference/compose-file/services/)
- [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [Protect the Docker daemon socket](https://docs.docker.com/engine/security/protect-access/)
- [Lima mount configuration](https://lima-vm.io/docs/config/mount/)
- [Lima port forwarding](https://lima-vm.io/docs/config/port/)
- [restic repository](https://github.com/restic/restic)
- [restic documentation](https://restic.readthedocs.io/en/stable/)
- [Kopia features](https://kopia.io/docs/features/)
- [CISA Data Backup Options](https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf)
- [Apple Bonjour](https://developer.apple.com/bonjour/)
- [Apple TN3179: Local Network Privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy?changes=__3)
- [pquerna/otp](https://github.com/pquerna/otp)

### 开源项目与集成边界

- [Uptime Kuma](https://github.com/louislam/uptime-kuma)
- [Dockge](https://github.com/louislam/dockge)
- [Dockge Docker API mismatch issue](https://github.com/louislam/dockge/issues/935)
- [Dockge YAML tag issue](https://github.com/louislam/dockge/issues/448)
- [Tailscale sharing](https://tailscale.com/kb/1354/share)
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
