# MacNAS 后端代码审查整改状态

日期：2026-09-11
对照文档：`docs/backend-code-review-2026-09-11.md`（P0–P3 共 15 项）
说明：本文记录审查报告各项的整改结果与证据位置，供验收与后续迭代对照。所有验证命令均在隔离环境（临时 HOME、`CC=/usr/bin/clang`）下执行。

## 验证结果汇总

| 检查 | 结果 |
|---|---|
| `go vet ./...` | 通过 |
| `go test ./...`（根模块，references 已隔离） | 全部通过 |
| `go test -race -count=1 ./...` | 全部通过，无竞态报告 |
| `npm run build`（web/） | 通过 |
| `rg "bash -c\|sh -c" pkg/ cmd/` | 无残留 |

## P0 整改结果（全部完成）

### 1. 权限模型与高危接口授权 — ✅ 完成

- `pkg/api/server.go`：所有状态变更与高危路由在注册处统一绑定 `adminOnly`（VM 生命周期、存储绑定、Docker 容器/镜像/Compose、应用安装与卸载、Samba、终端、文件写入、Linux 用户、SSH、root 密码）。
- Web 用户管理接口（`handleAuthListUsers` 等）内部仍有 `requireAdmin` 双重校验。
- 回归测试：`pkg/api/server_test.go` `TestAdminOnlyRequiresAdministrator`、`TestPrivilegedRoutesRejectRegularUsers`。

### 2. 消除 shell 注入 — ✅ 完成

- 全仓库（pkg/、cmd/）不再存在 `bash -c` / `sh -c` 拼接；外部命令一律 `exec.CommandContext(name, args...)` 参数数组调用。
- 输入白名单：容器名 `pkg/terminal/terminal.go` `validContainerRef`、VM 名 `config.NormalizeVMName`、数据盘/挂载 ID 正则、Compose 项目名校验、认证用户名/密码校验。
- 文件内容与密码通过 stdin 传递（`sudo tee`），不再走 `echo`。
- 本次新增注入元字符回归测试：`pkg/terminal/terminal_test.go`。

### 3. 文件系统根目录隔离 — ✅ 完成

- `pkg/terminal/files.go`：所有文件 API 先限制到 `/data`；列表、读取、预览、下载、写入、上传提交、复制、移动、重命名和删除进一步使用 `O_NOFOLLOW` + 目录文件描述符逐段遍历，在执行时锚定父目录，消除校验与操作分离的符号链接竞态。
- `isSystemProtectedDir` 保护系统目录与 `/data/.trash`。
- 词法校验本次抽取为 `normalizeRequestedPath` 纯函数并补单测（`pkg/terminal/files_test.go`），测试明确固定「词法层不做范围判定、拦截在 VM 侧」的分层契约。

### 4. 默认凭据与网络暴露收口 — ✅ 完成

- 移除固定初始密码：改为首次初始化现场设置流程（`auth.Manager.NeedsSetup` + `CreateInitialAdmin`），`POST /api/auth/setup` 仅接受 loopback 请求（有测试覆盖）。
- CORS 默认同源；跨域必须显式配置 `MACNAS_ALLOWED_ORIGINS`；WebSocket（日志与终端）统一 Origin 校验。
- 反向代理头默认不可信；仅 `MACNAS_TRUSTED_PROXIES` 中显式声明的 IP/CIDR 可以提供 `X-Forwarded-For` 与 `X-Forwarded-Proto`。初始化 loopback 判断、登录限速 IP、Secure Cookie 与 HSTS 均使用同一可信代理解析结果。
- 管理端默认监听 `127.0.0.1`（`config.NormalizeListenAddress`），局域网开放需显式配置。
- 登录限速：账号 + IP 双维度、5 次失败后指数退避锁定（`auth.Manager.LoginFrom`）。
- Lima 模板端口转发改为白名单端口列表 + `HostBindAddress`，不再整段透传。

### 5. 测试隔离 — ✅ 完成

- 所有测试使用 `t.Setenv("HOME", t.TempDir())` 与 fake/局部构造，不再触达真实 `~/.macnas`、磁盘、Lima 或 `caffeinate`。
- `pkg/api/server_test.go` 旧断言已更新为认证中间件行为（401/403）。
- 本次补齐原先零覆盖的 `pkg/terminal`（沙箱核心包）单元测试。

## P1 整改结果（全部完成）

### 6. 配置与密钥存储 — ✅ 完成

- 配置文件 `0600` 权限、temp+rename 原子写（`pkg/config/config.go`）；VM 配置同样 `0600`（`pkg/vm/vm.go`）。
- 旧默认 Samba 密码 `macnas123` 仅作为「需要轮换」的检测标记（`legacySambaPassword`），检测到即视为未设置秘密。
- Samba 全局 `map to guest = Never`、`force user = macnas`（非 root）。
- Alist 等应用安装时按安装实例生成随机密码，仅在安装流中展示一次（`pkg/apps/apps.go` `generateAppSecret`）。

### 7. 存储绑定与卸载事务化 — ✅ 完成

- 外接盘绑定改为事务式：预检 → 备份既有内部盘（`datadisk.internal.bak`）→ 软链 → 保存配置，任一步失败回滚；检测到已有备份或非受管链接时中止并要求人工处理，绝不自动删除既有镜像。
- 应用卸载默认 `docker compose down`（不带 `-v`，保留卷数据）；`DeleteComposeProject` 删除卷需显式 `deleteVolumes`，HTTP 层要求二次确认参数（有测试 `TestComposeDeleteWithVolumesRequiresConfirmation`）。

### 8. GET 隐藏副作用 — ✅ 完成

- `ListApps` 不再删除 Compose 文件；容器删除不再按前缀连带删除应用配置；Samba 状态读取无延迟 ApplyConfig。
- Compose YAML 读取改为管理员接口；读取内置模板直接返回本地内容，不再自动在 VM 中创建目录或写入配置。模板同步只允许发生在明确的启动、停止等状态变更操作中。

### 9. 上传下载与长任务 — ✅ 完成

- HTTP Server 改用 `ReadHeaderTimeout`，移除全局 15 秒读写超时对流式传输的影响。
- 上传：`http.MaxBytesReader` 10 GiB 上限、并发槽（2）、临时文件 + 原子改名提交、单 part 强制、413 语义保留。
- 下载/媒体流：子进程绑定请求 context（客户端断开即终止）；Range 请求完整 206/416 语义（`parseRange` 有单测）。
- 前端改用 Cookie 会话，原始 `fetch` 上传自动携带凭证。

### 10. 会话与密码 — ✅ 完成

- bcrypt（旧 HMAC 哈希在登录成功时自动升级）；Web 控制台密码下限 8 个字符并拒绝常见弱密码。
- 修改密码、修改角色、禁用用户即撤销全部会话；会话含空闲与绝对过期。
- Cookie `HttpOnly` + `SameSite=Strict`（TLS 时 `Secure`）；认证存储初始化失败拒绝启动（fail closed）。

## P2 整改结果

### 11. 后台操作并发与生命周期 — ✅ 完成

- VM 动作互斥（`BeginVMAction`，并发返回 409，有测试）、存储/Docker 操作级互斥（409，有测试）；后台任务纳入 `backgroundWG` + 服务器根 context，关闭时等待/取消。
- VM 启动、停止、重启返回 `jobId`；管理员可查询任务列表/详情并取消运行中的任务。任务状态、错误和时间戳以 `0600` 原子文件持久化，服务重启时将未完成任务明确标记为失败。

### 12. Docker/Lima 查询成本 — ✅ 完成

- 容器列表缓存与失效机制（`InvalidateContainerCaches`）、配置快照（`config.Snapshot`）复用。
- Docker 页面不可见时暂停轮询；目录列表每页最多 500 项（默认 300），API 返回 `hasMore/nextOffset`，文件页按需加载下一页，避免超大 JSON 和一次性渲染阻塞。

### 13. API Server 拆分 — ✅ 完成（2026-09-11 第二轮）

`pkg/api/server.go` 从 2859 行拆至 444 行，按业务边界拆为同包多文件（零行为变更，拆分前后 144 个顶层声明完全一致）：

- `server.go`：Server 结构、构造与生命周期、Handler 中间件（认证/Origin/安全头）、通用 helper
- `routes.go`：路由注册（权限矩阵单一入口）
- `handlers_system.go` / `handlers_vm.go` / `handlers_storage.go` / `handlers_docker.go` / `handlers_apps.go` / `handlers_samba.go` / `handlers_files.go` / `handlers_auth.go`：按领域分组的 handler

### 14. HTTP/WS 防护与错误响应 — ✅ 完成

- 安全响应头（CSP、nosniff、DENY、no-referrer、Permissions-Policy、HSTS）；`writeError` 对 5xx 脱敏（详情进日志、客户端只收稳定文案，有测试）。
- WebSocket Origin 策略统一：终端 upgrader 接收 server 传入的 allowlist，与 server 侧同源默认一致。

## P3 整改结果

### 15. 清理与边界 — ✅ 完成（2026-09-11 第二轮）

- ✅ `go mod tidy` 完成依赖修正。
- ✅（本次）`references/dockge` 增加 stub `go.mod` 将其隔离出根模块；因 `references/` 被 .gitignore，该文件不入库，重新克隆参考项目后需再次放置（根因是参考项目位于模块树内，长期方案是移出仓库）。
- ✅ 废弃路由删除：除上一轮移除的四条流式/WS 路由外，本轮确认前端统一使用容器 `action` 后，删除重复的独立 `start/stop/restart` 路由；删除无消费者的 `storage/select` 路由与客户端方法。

## 本次会话变更清单

1. `pkg/terminal/files.go`：抽取 `normalizeRequestedPath` 纯函数；清理重复注释。
2. `pkg/terminal/files_test.go`（新增）：路径词法校验、系统目录保护、回收站 ID 校验、Range 解析、MIME、字节格式化、上传错误映射，共 9 个测试函数。
3. `pkg/terminal/terminal_test.go`（新增）：容器名白名单的注入元字符拒绝测试，共 2 个测试函数。
4. `go.mod` / `go.sum`：`go mod tidy` 修正直接依赖标记。
5. `references/dockge/go.mod`（新增，本地）：模块边界隔离。

## 剩余非阻断性结构工作

1. 参考项目最终移出主仓库模块树；当前本地 stub `go.mod` 已隔离构建，但该文件因 `references/` 整体忽略而不随版本库分发。
2. 若后续长任务种类明显增加，可把当前 `pkg/api/jobs.go` 下沉为独立领域包；现阶段 VM 任务已具备查询、取消与重启恢复语义。

至此，审查报告 P0–P3 共 15 项的发布阻断项均已完成。
