# MacNAS 安全代码复审报告

日期：2026-09-12  
审查范围：Go API、认证与权限、WebSocket 终端、文件与压缩操作、云盘凭据、Docker/Compose、AI Skill 映射、发行脚本、Web 前端及依赖。  
审查方式：静态代码审查、路由权限核对、自动化测试、依赖审计。  
说明：以下结论以本轮整改后的代码为准；基线问题、修复证据和内网范围内的延期项均保留，便于回归验收。

## 一、结论

项目相较上一轮已经完成了重要的安全整改：高危写操作具有管理员保护，密码使用 bcrypt，会话改为 HttpOnly Cookie，文件操作被限制在 `/data`，WebSocket 校验来源，请求体与上传并发受限，配置和云盘 Cookie 以 `0600` 保存，服务端错误不会把内部路径直接返回给浏览器。

当前版本适合在**可信家庭局域网内进行 Beta 测试**，不应直接暴露到公网。SEC-01 和 SEC-03 已按本轮范围修复；SEC-02 默认 HTTP 作为可信内网边界暂缓，但发行说明必须明确“不支持安全公网访问”。

## 二、已修复的高风险项

### SEC-01 · P0 · 固定初始管理员密码在初始化后继续有效（已修复）

基线问题：

- 基线曾在认证服务和 Web 页面内固定 `admin/admin123`，且初始化后立即使用该凭据登录。

修复证据：

- `pkg/auth/manager.go` 的 `CreateInitialAdmin` 现在复用正常密码校验，不再存在固定初始密码常量；
- `web/src/pages/LoginPage.tsx` 让用户现场填写账号、密码和确认密码，并在前端提示至少 12 字节；
- bcrypt 密码哈希、首次初始化仅限 loopback 和“只能创建第一个管理员”的约束保持不变；
- README、CLI 安装文档和手测清单已删除固定生产密码描述。

验收标准：全新安装页面不显示固定密码；弱密码被拒绝；用户选择的强密码可以直接完成首次登录。

### SEC-02 · P0 · 局域网默认使用明文 HTTP（可信内网暂缓）

证据：

- `scripts/install.sh:7` 默认监听 `0.0.0.0`；
- `cmd/macnas/main.go:193-207` 使用 `ListenAndServe`，没有内置 TLS；
- `pkg/api/handlers_auth.go:17-25` 仅在请求被识别为 HTTPS 时设置 Cookie 的 `Secure` 属性。

影响：在不可信 Wi-Fi、被劫持的局域网或错误的公网端口映射中，登录密码、Cookie、文件内容和终端数据可能被旁路监听或篡改。

本轮决策：按产品仅服务可信家庭 LAN 的定位暂不内置 TLS；README、发行文档和菜单入口必须明确不支持直接公网访问，用户自行映射到公网的风险不由本项目承担。

建议完成标准：默认只监听 `127.0.0.1`；启用局域网时明确提示“仅可信 LAN”；正式远程访问通过 HTTPS 反向代理或 VPN；提供受信代理和 HTTPS 部署文档；公网场景强制 Secure Cookie 和 HSTS。

### SEC-03 · P0 · 缺少 Host 白名单，存在 DNS Rebinding 攻击面（已修复）

基线问题：

- `Origin == http(s)://r.Host` 会把任意 Host 当作同源，HTTP 服务没有验证 Host 是否为本机地址。

修复证据：

- `pkg/api/server.go` 对所有 `/api/` 请求执行 Host 校验；默认只接受 `localhost`、非未指定的 IP 字面量，反向代理域名必须通过 `MACNAS_ALLOWED_HOSTS` 显式登记；
- 未登记 Host 返回 421，不再进入认证、CORS 或业务路由；
- `pkg/api/server_test.go` 覆盖恶意域名、局域网 IP、localhost 和登记域名。

验收标准：自定义域名解析到 Mac IP 但未登记时 API/终端 WebSocket 被拒绝；登记域名配合反向代理时正常工作。

## 三、内网范围内的 P1 项与本轮降级处理

### SEC-04 · 普通用户具有全部 NAS 数据的读取能力（家庭共享定位暂缓）

`pkg/api/routes.go:104-117` 中目录列表、读取、下载、媒体预览和回收站列表只要求登录，不要求管理员；云盘挂载和文件列表也允许普通用户读取。服务端虽然把路径限制在 `/data`，但没有按用户、共享或目录设置 ACL。

如果产品定义是“家庭成员共享所有资料”，应在界面和文档明确说明；如果期望不同用户拥有私有目录，则当前权限模型不满足要求。建议引入共享级权限：管理员、只读成员、读写成员、私有目录所有者。

本轮决策：当前产品按家庭成员共享 NAS 数据处理，暂不引入目录 ACL；若未来支持访客、多人租户或私有目录，必须重新评估并升级权限模型。

### SEC-05 · AI Skill 映射可选择几乎任意宿主机绝对目录（已降级处理）

`pkg/config/config.go:239-257` 只拒绝相对路径和 `/`，不要求目录必须是 `.agents/skills`，也刻意不解析符号链接；`pkg/api/handlers_system.go:436-458` 只检查路径存在且为目录。虽然 VM 挂载为只读，但管理员误填 `/Users/用户名`、`.ssh` 或一个指向敏感目录的符号链接时，VM/AI CLI 仍可读取宿主机私密文件。

本轮处理：保留管理员自定义绝对路径能力，但 `Settings` 增加醒目的敏感目录风险提示和确认勾选，`POST /api/system/terminal/skills` 同时要求 `confirmRisk=true` 才能启用；映射仍为只读。后续可再收紧到自动扫描候选目录并做真实路径解析。

### SEC-06 · 7z/RAR 解压依赖外部工具的路径安全行为（已修复主要风险）

基线中 7z/RAR 直接以 VM root 调用外部工具，没有先枚举并验证归档条目。

本轮处理：7z 使用结构化 `-slt`、RAR 使用安静目录清单预检，拒绝绝对路径、父目录跳转、控制字符和符号链接属性；目录清单限制 8 MiB。外部工具解压到目标目录下的临时目录，解压结果拒绝符号链接和特殊文件，通过 `O_NOFOLLOW` 逐项复制到目标目录后清理临时目录。仍建议后续增加压缩炸弹配额和真实 VM 中的 7z/RAR 恶意样本回归测试。

### SEC-07 · 安装链与容器镜像缺少可重复供应链验证（内网测试暂缓）

- `templates/vm/macnas.yaml.tmpl:68-71` 在初始化时执行 `curl -fsSL https://get.docker.com | sh`；
- 社区商城从第三方 GitHub、镜像站和 CDN 获取目录，未进行签名验证；
- 多数 Compose 模板使用 `latest` 或普通 tag，而不是镜像 digest。

这不等于当前来源已被攻破，但会让同一个 Release 在不同日期安装出不同内容。建议固定 Docker 安装版本和校验和；社区目录增加签名；核心应用固定 digest 或至少固定版本 tag；在 UI 中显示镜像来源、维护者、更新时间和信任级别。

### SEC-08 · 限流和审计日志仍主要集中在登录接口（内网测试暂缓）

登录已有按 IP 与账号退避，上传有 10 GiB 上限和并发槽，终端也限制消息及会话数量；但文件下载、媒体 Range、云盘遍历、Docker 状态轮询等昂贵接口缺少用户/IP 级并发和速率限制。管理员的删除、终端、挂载、Compose 部署等高危操作也没有统一的结构化审计日志。

建议：为流式下载、云盘任务和高频查询增加并发配额；记录时间、用户、来源 IP、动作、对象、结果和 request ID，且对密码、Cookie、Token、Compose secret 做脱敏。

## 四、已确认有效的安全控制

- API 默认要求认证，首次管理员创建仅允许本机请求；
- 高危写操作及 root Web 终端使用 `adminOnly`；
- 密码采用 bcrypt，普通密码至少 12 字节；
- 登录失败按账号和 IP 退避，密码/角色/禁用变更会撤销会话；
- 会话使用随机 256-bit Token、HttpOnly、SameSite=Strict Cookie；
- CORS 默认同源，WebSocket 对 Origin 做相同校验；
- CSP、X-Frame-Options、nosniff、Referrer-Policy 等响应头已设置；
- JSON 请求体限制 8 MiB，上传限制 10 GiB并限制并发；
- 文件路径会在 VM 内解析并限制到 `/data`，关键写操作使用文件描述符和 `O_NOFOLLOW`；
- ZIP 解压拒绝目录穿越和符号链接；
- 配置、用户、任务和终端设置文件使用原子替换及 `0600` 权限；
- 夸克 Cookie 不会通过 JSON API 返回；
- Docker、Lima 及系统命令大多使用参数数组和 stdin，不直接拼接用户输入到 shell。

## 五、自动化验证结果

| 检查 | 结果 |
| --- | --- |
| `env CC=/usr/bin/clang go test ./...` | 通过 |
| `env CC=/usr/bin/clang go vet ./...` | 通过 |
| `web/npm audit --audit-level=low` | 通过，0 个已知漏洞 |
| `web/npm run build` | 通过；存在约 1 MB 主 JS 包体积警告，不属于安全失败 |
| `desktop/npm audit --audit-level=low` | 通过，0 个已知漏洞 |
| 当前源码敏感信息模式扫描 | 未发现 API Key、私钥、云服务 Token 或固定控制台初始密码 |

首次直接运行 Go 测试时，本机 Homebrew Go 1.27 的 cgo 未自动找到可用编译器；显式使用系统 `/usr/bin/clang` 后全部通过。这属于构建环境兼容问题，不是测试失败。

本机未安装 `govulncheck`、`gosec`、`shellcheck` 或 `gitleaks`，因此本轮未包含 Go 漏洞数据库、规则式静态扫描、Shell 规则扫描和完整 Git 历史秘密扫描。建议把这些工具放入 CI，并把结果作为 Release 门禁。

## 六、发布建议

可信家庭 LAN Beta 可以继续；路由器不得做公网端口映射。SEC-01、SEC-03 已关闭，SEC-05 已加入风险提示和服务端二次确认，SEC-06 已加入外部归档预检与临时目录隔离。SEC-02、SEC-04、SEC-07、SEC-08 按当前内网定位暂缓，但 Release 必须明确“仅可信局域网、不支持直接公网访问”。
