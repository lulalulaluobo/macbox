# MacNAS 后端代码审查报告

日期：2026-09-11  
范围：以 Go 后端为主，同时检查与后端契约直接相关的前端 API 调用、Lima/Docker/Samba 模板、配置持久化与测试体系。  
原则：本轮只审查，不修改业务代码。

## 一、结论摘要

当前项目已经具备完整产品雏形，但后端安全边界仍处于“单管理员、本机工具”的实现阶段，与现在已经出现的多用户、局域网访问、Docker 管理、Web 终端、文件管理等能力不匹配。

最重要的结论有五项：

1. **角色存在，但权限没有真正落地。** 除用户管理接口外，大多数高危接口只验证“已登录”，普通用户也能进入 root 终端、修改 root 密码、管理 Docker、存储、SMB 与文件。
2. **多处存在命令注入风险。** 用户输入被拼接进 `bash -c`，覆盖容器名、镜像名、路径、密码、Compose 项目名、SSH 公钥等入口。
3. **文件 API 没有目录沙箱。** `path.Clean` 只能规范路径，不能阻止访问 `/etc`、`/root` 或挂载到虚拟机的主机目录；删除保护也只挡住少数“目录本身”，挡不住目录内文件。
4. **默认账号、开放 CORS、全网卡监听和大范围端口转发形成组合风险。** 单独看每项未必立即失守，组合后会显著扩大局域网与浏览器攻击面。
5. **测试没有隔离真实环境。** 部分测试会保存到真实 `~/.macnas/config.yaml`、读取真实磁盘并启动 `caffeinate`，导致测试不能安全地作为发布门禁。

总体评级：**高风险，建议在继续扩展功能前先完成 P0 安全边界整改。** 目前不建议直接暴露到公网；局域网部署也应先更换默认凭据并限制监听与防火墙范围。

## 二、优先级总表

| 顺序 | 优先级 | 项目 | 主要后果 | 建议完成标准 |
|---:|:---:|---|---|---|
| 1 | P0 | 权限模型与高危接口授权 | 普通用户可获得管理员/root 能力 | 所有路由有明确权限矩阵，越权测试全部通过 |
| 2 | P0 | 消除 shell 注入 | 远程命令执行、宿主/VM 数据破坏 | 请求参数不再拼接进 shell；集中验证与命令执行层 |
| 3 | P0 | 文件系统根目录隔离 | 任意文件读取、覆盖、删除 | 所有文件操作限制到允许根目录并处理符号链接 |
| 4 | P0 | 默认凭据与网络暴露收口 | 局域网接管、浏览器跨域攻击 | 首次初始化、强制改密、限速、同源 CORS、最小端口暴露 |
| 5 | P0 | 测试隔离 | 测试破坏真实 NAS 配置/进程 | 全部测试只使用临时目录和 fake runner，无真实副作用 |
| 6 | P1 | 配置与密钥存储 | 明文密码泄漏、并发丢配置 | `0600`、随机秘密、集中 ConfigStore、原子更新 |
| 7 | P1 | 存储与卸载事务化 | 磁盘镜像/卷数据不可逆丢失 | 预检、锁、回滚、保留数据默认值、错误不吞掉 |
| 8 | P1 | 上传下载与长任务模型 | 大文件失败、资源耗尽、僵尸进程 | 限额、可取消、流式超时、任务状态可追踪 |
| 9 | P1 | 会话安全 | 长期 token 被盗后持续有效 | 标准密码哈希、会话撤销、短期票据、安全 Cookie |
| 10 | P2 | 后台任务与并发控制 | 重复启停、状态冲突、竞态 | 单飞/队列、服务级 context、优雅关闭 |
| 11 | P2 | Docker/Lima 调用性能 | 高频轮询造成 CPU/进程压力 | 轻重数据拆分、缓存、合并请求、可见性轮询 |
| 12 | P2 | 后端结构拆分 | 修改成本高、重复校验、难测试 | 按领域拆包并引入 policy/exec/config/job 基础层 |
| 13 | P3 | 路由、依赖和仓库清理 | 维护噪音、测试范围意外扩大 | 删除废弃 API，整理模块依赖，隔离 references |

## 三、P0：必须最先处理

### 1. 身份认证完成了，但授权边界基本缺失

证据：

- `pkg/api/server.go:78` 定义了 `requireAdmin`，但实际只在 `pkg/api/server.go:2132`、`2143`、`2166`、`2195` 的 Web 用户管理接口使用。
- VM 生命周期、Docker/Compose、应用安装、自定义 YAML、存储绑定、SMB、文件操作、Linux 用户、SSH 与终端接口均只经过通用登录校验。
- `pkg/api/server.go:1515` 的终端 WebSocket 接口允许请求终端用户；`pkg/terminal/terminal.go:49-51` 可以进入容器 root shell。
- `POST /api/system/root/password` 注册于 `pkg/api/server.go:279`，没有管理员权限保护。

业务冲突：系统已经建模了 `admin` 和 `user`，但后端实际上将二者视为同一权限。前端隐藏按钮不是权限控制，直接请求 API 仍然可执行。

建议：

- 先建立权限矩阵，而不是在处理函数里零散添加判断。至少划分：只读、文件写入、容器运维、系统管理员、账号管理员。
- 在路由注册处统一绑定 policy；默认拒绝，明确放行。
- root 终端、root 密码、SSH 密钥、磁盘绑定、SMB 配置、自定义 Compose、卸载并删卷必须是管理员能力。
- 为每个高危路由增加“普通用户返回 403”的回归测试。

### 2. 请求参数进入 shell，存在多条命令注入路径

代表性位置：

- 容器终端：`pkg/terminal/terminal.go:49-51` 将容器名拼进 `docker exec` 的 shell 字符串。
- 文件写入：`pkg/terminal/files.go:151` 将路径拼进重定向命令；上传和媒体流同样通过 shell/Python 字符串处理路径。
- 镜像拉取：`pkg/docker/images.go:86` 拼接 `docker pull <image>`。
- Compose：`pkg/docker/compose.go:15` 虽然有项目名正则，但只在部分入口使用，查询、操作、删除没有共享同一校验边界。
- 应用管理：`pkg/apps/apps.go:280`、`362` 拼接应用目录与 Compose 命令。
- Samba、Linux 用户和 SSH：密码、公钥、路径或配置内容通过单引号包裹后进入 shell；单引号、换行和控制字符并未形成统一防线。

建议：

- 可以用参数数组调用的命令一律使用 `exec.CommandContext(name, args...)`，禁止为方便而套 `bash -c`。
- 文件内容和密码走 stdin；文件写入使用 Go 文件 API 或受控的 VM 文件代理，不走 `echo`。
- 建立集中 `execx.Runner`：负责超时、取消、输出上限、审计日志和敏感参数脱敏。
- 为容器名、镜像引用、Compose 项目名、Linux 用户名、共享名、guest target 建立独立类型和白名单验证器。
- 对引号、空格、换行、反斜杠、Unicode 控制字符和超长输入建立表驱动安全测试。

### 3. 文件管理 API 缺少允许根目录约束

证据：

- `pkg/terminal/files.go:55`、`133`、`148`、`166` 等入口只调用 `path.Clean`。
- `pkg/terminal/files.go:188` 的 `isSystemProtectedDir` 只保护少量路径本身；例如禁止删除 `/etc`，不等于禁止操作 `/etc/passwd`。
- 列表、读取、写入、上传、下载、媒体预览、复制、移动、重命名和删除均接受客户端路径。

影响：任意已登录用户可能读取或修改 VM 根文件系统；当 VirtioFS 暴露主机目录后，还可能触达被挂载的主机文件。UI 默认从 `/data` 打开不能替代服务端约束。

建议：

- 统一实现 `ResolveAllowedPath(user, operation, requestedPath)`，所有文件 API 强制经过它。
- 默认只允许 `/data`；额外本机直通目录必须来自后端配置快照，不能由请求自行声明。
- 使用真实路径解析处理符号链接，并验证解析后的路径仍位于允许根目录内。
- 区分读、写、删除权限；系统目录及其全部后代默认拒绝。
- 大批量删除/移动应先生成操作计划，再确认并执行；记录审计日志。

### 4. 默认凭据与网络暴露形成可利用的组合链

证据：

- `pkg/auth/manager.go:81-93` 在没有用户时自动创建 `admin/admin123`。
- `web/src/pages/LoginPage.tsx:42`、`179` 会填充或显示默认密码。
- `pkg/api/server.go:132-134` 对 API 返回 `Access-Control-Allow-Origin: *`，并允许 `Authorization`。
- `cmd/macnas/main.go:179` 监听 `0.0.0.0`。
- `templates/vm/macnas.yaml.tmpl:175`、`179` 将端口暴露到 `0.0.0.0`；模板还覆盖很大的 guest 端口范围。
- 登录没有频率限制、失败锁定或首次登录强制改密。

风险链：局域网内网页或恶意站点可尝试访问 NAS；若默认账号未修改，开放 CORS 允许读取登录响应并继续调用高危 API。现代浏览器的私网访问限制可能缓解部分场景，但不能作为安全边界。

建议：

- 首次启动进入初始化流程，随机生成一次性口令或要求本机创建管理员；移除 UI 中的默认密码提示。
- 未完成初始化前不开放高危服务；首次登录必须改密。
- 默认同源，CORS 仅允许显式配置的源；WebSocket 同样校验 Origin。
- 管理端默认仅监听 loopback，局域网开放应是明确配置；配套 TLS 或可信反向代理。
- 只映射已配置服务端口，禁止 1024–65535 整段透传。
- 登录增加 IP/账号双维度限速、指数退避和安全日志。

### 5. 测试会污染真实运行环境

本次审查中，运行现有测试触发了真实副作用：`pkg/storage/storage_test.go` 调用存储配置函数，而这些函数最终执行 `config.SaveConfig`，写入真实 `~/.macnas/config.yaml`。API Server 构造过程还会创建真实管理器并启动 `caffeinate`。

本次处置情况：

- 已立即停止继续运行有副作用的全量测试。
- 已依据仍在运行的 MacNAS API 返回值恢复 VM、存储、挂载和 SMB 共享等可观测配置。
- Samba 密码不会由 API 返回，因此该字段无法从运行态核对；恢复值为当前项目默认值 `macnas123`。如果此前手动改过 Samba 密码，建议用户重新确认一次。
- 未修改任何项目业务代码。

根因：

- 配置路径、命令执行器、文件系统、时钟和后台服务都是硬编码或全局单例。
- `pkg/api/server_test.go` 仍按“匿名访问返回 200”的旧行为断言，与新增认证中间件冲突。
- `pkg/storage/storage_test.go`、`pkg/config/config_test.go`、`pkg/vm/vm_test.go` 会触达真实 HOME、磁盘、`/tmp` 或 Lima。

建议：

- P0 修复之前，不把当前 `go test ./...` 当作安全的本机命令。
- 引入 `ConfigRepository`、`CommandRunner`、`FileSystem`、`Clock` 接口；测试全部使用 `t.TempDir()` 和 fake runner。
- 构造函数不得启动进程或 goroutine；用显式 `Start/Close` 管理生命周期。
- PowerManager 不应是跨测试共享的全局单例。
- CI 使用临时 HOME，并禁止访问真实 Lima/Docker；集成测试放入独立标签与隔离环境。

## 四、P1：安全边界之后立即整改

### 6. 配置、秘密和权限模型不安全

- `pkg/config/config.go:188` 以 `0644` 写配置；当前配置包含 Samba 明文密码。
- `pkg/vm/vm.go:278`、`287` 生成的 VM 配置也是 `0644`。
- `pkg/apps/apps.go:303-305` 固定设置 Alist 管理员密码 `adminadmin123`，前端还直接展示该密码。
- Samba 默认允许 guest、`force user = root`，并使用 `0777` 掩码（`pkg/samba/samba.go:306-313`）。VM 模板也对 `/data` 执行 `chmod 0777`（`templates/vm/macnas.yaml.tmpl:66-74`）。
- 多个 Manager 共享并直接修改同一个 `*config.Config`；`SaveConfig` 的锁只保护写文件过程，不能保护内存中的复合读改写，可能出现竞态和配置覆盖。
- 多处忽略 `SaveConfig` 错误，接口可能向用户报告成功，但重启后配置丢失。

建议：集中 `ConfigStore`，通过 `Update(func(*Config) error)` 原子更新并返回不可变快照；配置和密钥文件使用 `0600`；安装应用时生成随机秘密并只显示一次；Samba 默认禁用 guest、移除 root 强制用户、采用最小权限。

### 7. 存储绑定和应用卸载包含数据丢失路径

- `pkg/storage/storage.go:497-509` 在目标 datadisk 已存在且备份也存在时直接删除目标普通文件，相关 `Remove/Rename` 错误被忽略。
- `pkg/storage/storage.go:520`、`588` 忽略配置保存错误；VM 挂载操作也缺少统一回滚。
- 绑定/解绑没有互斥锁、VM 状态预检、事务记录或崩溃恢复；并发请求可能产生软链接、配置与实际磁盘不一致。
- `pkg/apps/apps.go:362` 卸载应用固定执行 `docker compose down -v`，默认删除卷数据。
- `pkg/docker/compose.go:247-259` 吞掉 `compose down` 与删除目录的错误，最终始终返回成功。

建议：

- 存储操作改为状态机：预检 → 停止写入 → 备份元数据 → 执行 → 验证 → 提交；任一步失败自动回滚。
- 绝不自动删除已有磁盘镜像；冲突时中止并要求显式选择。
- 卸载默认保留数据，删除卷必须二次确认且展示将被删除的卷。
- 所有部分失败必须返回可操作错误，不能吞掉。

### 8. GET 请求和普通删除操作存在隐藏副作用

- `pkg/apps/apps.go:47` 的 `ListApps` 是读取接口，但在发现 Compose 文件存在、容器不存在时，会于 `pkg/apps/apps.go:149-150` 后台删除 Compose 文件。
- 容器删除在 `pkg/docker/containers.go:177-197` 根据名称前缀自动删除应用 Compose 文件。
- Samba 状态读取首次调用时会延迟执行 ApplyConfig（`pkg/samba/samba.go:130-132`）。

这违反了读取接口无副作用原则，也会把“容器临时停止/创建失败”误判为“配置应删除”。建议把发现、修复和删除拆开：GET 只报告不一致；显式“修复/清理”接口展示计划并确认执行。

### 9. 大文件传输、媒体播放和长任务会被 15 秒超时截断

- HTTP Server 在 `cmd/macnas/main.go:183-184` 设置全局 `ReadTimeout`、`WriteTimeout` 为 15 秒。
- 上传没有请求体大小上限、磁盘配额或并发限制，可填满 VM/宿主磁盘。
- 下载和媒体流启动外部进程，但未统一绑定请求 context；客户端断开后可能继续运行。
- 视频 Range 请求每次创建新的 `limactl` 与 Python 进程；无效 Range 没有完整的 416 语义。
- `web/src/api.ts:274-281` 的上传使用原始 `fetch`，没有携带 Authorization，和其他 API 包装器不一致；认证开启后上传会返回 401。

建议：用 `ReadHeaderTimeout` 保护头部；上传按用户/文件设置上限和并发配额；流式 handler 单独管理超时；所有子进程使用 `CommandContext`；媒体与文件传输优先使用常驻 VM agent/SFTP，而不是每个 Range 启动一次 shell。

### 10. 会话与密码实现需要标准化

- `pkg/auth/manager.go:162` 是自定义 10,000 次 HMAC 循环，不是标准 PBKDF2/Argon2id/bcrypt 实现。
- 最短密码仅 6 位（`pkg/auth/manager.go:398-399`、`467-468`）。
- `crypto/rand.Read` 错误被忽略（`pkg/auth/manager.go:158`、`202`、`318`）。
- 会话保存在内存；过期会话主要在访问时清理，重复登录会持续增长。
- 修改密码、禁用用户或降级角色时没有统一撤销既有会话；删除用户才会撤销（`pkg/auth/manager.go:441-446`）。
- Token 存于 `localStorage`（`web/src/api.ts:7`），下载、预览和 WebSocket 还会使用 URL token，可能进入日志、历史或错误报告。
- Auth Manager 初始化失败后服务仍可能继续启动，后续请求存在 nil 使用风险，安全上应 fail closed。

建议：Argon2id 或 bcrypt；至少 12 位或长口令；密码/角色/启用状态改变时撤销全部会话；增加空闲与绝对过期；HTTP 使用 HttpOnly、Secure、SameSite Cookie；WebSocket 和下载使用一次性短期票据；认证存储初始化失败则拒绝启动。

## 五、P2：可靠性、性能和结构优化

### 11. 后台操作缺少统一并发与生命周期管理

VM 启动、停止、重启和挂载同步会直接创建 `context.Background()` goroutine（如 `pkg/api/server.go:327-350`、`595-749`）。目前没有：

- 同一资源的 single-flight/互斥；
- 可查询的任务 ID 与阶段；
- 取消、超时和服务器关闭传播；
- 崩溃后的任务状态恢复；
- 对并发“启动+停止”“绑定+解绑”的冲突判定。

建议建立 `JobManager` 与资源级 operation lock。HTTP 提交任务后返回 job ID，状态、日志、失败原因统一查询；所有任务派生自服务器根 context，并在关闭时等待或取消。

### 12. Docker/Lima 查询重复且轮询成本偏高

- `pkg/docker/overview.go:12` 调用 `ListContainers`，随后 `ListComposeProjects`；后者在 `pkg/docker/compose.go:89` 再次调用 `ListContainers`。
- `ListContainers` 还执行 stats；应用列表 `pkg/apps/apps.go:52` 只是判断状态，却同样承担完整统计成本。
- 前端多个页面以 5–10 秒周期分别轮询 overview、containers、compose 和全局状态，后端因此频繁启动 Docker/Lima 子进程。
- 文件目录每次列表也启动 `limactl shell python3`；超大目录没有分页，收藏页还可能并发查询多个父目录。

建议：

- 拆分轻量容器清单与实时 stats；只在可见详情页拉 stats。
- 后端提供 1–3 秒短 TTL 的快照缓存与 singleflight，overview 复用同一份容器数据。
- 前端页面不可见时停止轮询；可考虑单一系统快照接口或 SSE 推送状态变化。
- 文件列表增加 cursor 分页/分段加载；长期可用一个 VM 内常驻 agent 取代每次 shell。

### 13. API Server 和领域边界过度集中

`pkg/api/server.go` 超过 2,200 行，混合了路由、认证、CORS、参数解析、业务编排、SSE、WebSocket、错误输出和后台任务。Shell 命令构造又分散在 `apps`、`docker`、`samba`、`system`、`terminal`、`vm` 包，导致验证和错误处理不一致。

建议目标结构：

```text
internal/httpapi/
  middleware/     # auth、RBAC、origin、request id、限速
  errors/         # 统一错误码和安全响应
  files/ docker/ apps/ storage/ samba/ system/
internal/policy/  # 权限矩阵与路径策略
internal/execx/   # typed command runner、超时、脱敏、输出上限
internal/configstore/
internal/jobs/
internal/domain/  # 领域服务接口与事务编排
```

拆分原则是按业务边界，不要把每个 handler 拆成一个小包。Web NAS 用户与 Linux VM 用户应在命名、路由和权限说明上明确区分，避免“用户管理”概念重叠。

### 14. HTTP/WS 防护和错误响应不统一

- `pkg/api/server.go:32` 与 `pkg/terminal/terminal.go:18` 各自维护一个 WebSocket upgrader，且都无条件允许 Origin。
- API 多处直接把 `err.Error()` 返回客户端，可能泄露宿主路径、命令输出和环境细节。
- 缺少统一 CSP、`frame-ancestors`/X-Frame-Options、`nosniff`、Referrer-Policy；启用 TLS 后还应设置 HSTS。

建议只保留一个受控 upgrader；同源默认；服务端日志记录详细错误和 request ID，客户端只返回稳定错误码与必要信息。

## 六、P3：清理与维护性

### 15. 重复/遗留接口与仓库边界

- 容器操作同时存在通用 action 与独立 start/stop/restart 路由。
- 同步与 stream 版本接口并存，但当前前端没有明显使用部分旧 stream 路由。
- `storage/select` 看起来没有当前前端调用，且只改“选中值”，不验证或完成实际绑定，容易制造状态歧义。
- `references/` 约 104 MB，虽然被 Git 忽略，但其中 `references/dockge/extra` 没有独立 `go.mod`，会被根目录 `go test ./...` 意外纳入。
- `go.mod` 中多项实际直接依赖被标为 indirect；`go mod tidy -diff` 能看到整理差异。

建议在完成安全回归测试后再删旧接口；先加调用统计或代码搜索确认无消费者。把参考项目移到根 module 之外，或用嵌套 module/workspace 明确隔离。

## 七、测试与工具结果

### 已执行检查

- `CC=/usr/bin/clang go vet ./...`：通过；依赖 `go-m1cpu` 有编译器 VLA 警告。
- `CC=/usr/bin/clang go test ./...`：失败于 `pkg/api` 的旧测试，测试仍期望匿名接口返回 200，当前认证中间件返回 401；其余被执行包通过，但覆盖率很低。
- `CC=/usr/bin/clang go test -race ./...`：同样失败，并暴露真实配置写入问题，因此不应继续在工作机直接运行。
- `npm audit --json`：生产与开发依赖合计 195 个包，当前报告 `0` 个已知漏洞。
- `go mod tidy -diff`：发现若干直接依赖被错误标为 indirect；未写入文件。
- 当前环境未安装 `govulncheck`、`staticcheck`、`golangci-lint`，因此本轮没有伪造这些工具的结论。

环境问题：当前 shell 中的 `cc` 指向非 C 编译器程序，带 cgo 的默认 Go 测试会失败；显式使用 `/usr/bin/clang` 后才能进行上述检查。建议在 Makefile/CI 中固定 Darwin 编译器或记录环境要求。

### 测试覆盖缺口

优先新增：

1. 普通用户访问每类管理员接口必须 403。
2. 路径穿越、符号链接逃逸、系统目录后代访问。
3. 容器名、镜像名、用户名、密码、路径、公钥中的 shell 元字符。
4. 上传大小、并发上传、客户端断开与磁盘空间不足。
5. VM 并发启停、存储绑定失败回滚、Compose 部分失败。
6. 配置并发更新与进程崩溃后的原子性。
7. CORS/Origin、默认管理员初始化、登录限速、改密后的会话撤销。
8. 应用卸载/删除卷的保留数据默认行为。

## 八、推荐实施顺序

### 阶段 0：立即运行侧缓解（不依赖重构）

1. 确认并更换 Web 管理员、Samba、Alist 及模板中的所有默认密码。
2. 仅在可信局域网运行，防火墙限制管理端口；不要公网映射。
3. 暂停给非管理员创建 Web 账号，直到 RBAC 完成。
4. 暂停在工作机直接执行现有存储/API 全量测试。
5. 确认 Samba 密码是否因本次测试恢复需要重新设置。

### 阶段 1：建立可安全修改的基础（建议第一个开发迭代）

1. 测试隔离与依赖注入。
2. 路由权限矩阵和统一 policy middleware。
3. 文件根目录策略。
4. `execx.Runner` 与输入类型验证，逐步移除 `bash -c`。
5. 为前三项建立安全回归测试。

这几项应一起做：没有隔离测试就无法安全验证权限和命令执行重构；只修其中一条注入点也会留下同类入口。

### 阶段 2：数据安全与认证加固

1. ConfigStore、`0600`、秘密生成/轮换。
2. 存储绑定状态机与回滚。
3. 应用卸载默认保留数据，移除 GET 隐藏副作用。
4. 标准密码哈希、会话撤销、短期票据、登录限速。
5. 同源 CORS、WS Origin、最小端口映射。

### 阶段 3：效率与结构

1. JobManager 与资源锁。
2. Docker/Lima 快照缓存、重复调用合并。
3. 大文件流式模型、上传限额、媒体 Range 优化。
4. 按领域拆分 `server.go`，统一错误模型。
5. 清理废弃路由、依赖和 references 测试边界。

## 九、验收门槛

完成整改后，建议把以下条件作为可发布标准：

- 普通用户无法调用任何系统、root、Docker 管理、存储绑定或 SMB 管理接口。
- 所有外部输入都不能改变预期命令结构；高危调用无字符串 shell 拼接。
- 文件 API 在路径穿越与符号链接场景下无法逃出允许根目录。
- 配置文件与秘密权限为 `0600`，安装时无固定密码。
- GET 请求无删除、写配置或启动服务副作用。
- 存储与卸载操作可预检、可回滚、默认保留数据。
- 现有测试可在临时 HOME 中重复运行，不触碰真实 Lima、Docker、磁盘、配置和电源管理。
- `go test -race ./...`、`go vet ./...`、前端测试/构建、依赖审计在 CI 中稳定通过。
- 大文件上传、下载、预览不受 15 秒全局写超时影响，断开连接会终止子进程。

## 十、审查边界

本报告基于静态代码审查和有限的本机测试，不包含真实攻击演练、网络抓包、容器镜像供应链扫描、运行中数据竞态全覆盖或公网部署配置审计。由于当前测试隔离缺陷，本轮没有继续执行可能影响真实 NAS 状态的破坏性验证。
