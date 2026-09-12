# MacNAS 安全代码复审报告

日期：2026-09-12  
审查范围：Go API、认证与权限、WebSocket 终端、文件与压缩操作、云盘凭据、Docker/Compose、AI Skill 映射、发行脚本、Web 前端及依赖。  
审查方式：静态代码审查、路由权限核对、自动化测试、依赖审计。  
原则：本轮只审查，不修改业务代码。

## 一、结论

项目相较上一轮已经完成了重要的安全整改：高危写操作具有管理员保护，密码使用 bcrypt，会话改为 HttpOnly Cookie，文件操作被限制在 `/data`，WebSocket 校验来源，请求体与上传并发受限，配置和云盘 Cookie 以 `0600` 保存，服务端错误不会把内部路径直接返回给浏览器。

当前版本适合在**可信家庭局域网内进行 Beta 测试**，但还不适合直接暴露到公网。正式公开分发前建议至少解决 3 个 P0 阻断项：固定初始管理员密码、默认明文 HTTP、DNS Rebinding/任意 Host 风险。

## 二、发布阻断项

### SEC-01 · P0 · 固定初始管理员密码在初始化后继续有效

证据：

- `pkg/auth/manager.go:85-90` 固定定义 `admin/admin123`；
- `pkg/auth/manager.go:554-564` 仅允许用该固定凭据创建首个管理员；
- `web/src/pages/LoginPage.tsx:11-17` 在页面内公开并预填该密码；
- `web/src/pages/LoginPage.tsx:46-52` 初始化后立即使用同一密码登录；
- 当前没有“首次登录必须改密”状态。

影响：用户在 Mac 本机完成初始化后，如果没有立即改密，任何能访问局域网服务的人都知道有效管理员凭据，可进入 root 终端、管理 Docker、读取 NAS 文件及修改系统配置。

建议完成标准：首次初始化页面要求用户现场设置至少 12 字节的新密码；后端不再接受固定密码创建管理员；旧安装检测到默认密码时强制改密；Release 文档不再公开可长期使用的默认管理员密码。

临时测试要求：每次全新安装完成后，第一步必须修改控制台密码，再开放局域网访问。

### SEC-02 · P0 · 局域网默认使用明文 HTTP

证据：

- `scripts/install.sh:7` 默认监听 `0.0.0.0`；
- `cmd/macnas/main.go:193-207` 使用 `ListenAndServe`，没有内置 TLS；
- `pkg/api/handlers_auth.go:17-25` 仅在请求被识别为 HTTPS 时设置 Cookie 的 `Secure` 属性。

影响：在不可信 Wi-Fi、被劫持的局域网或错误的公网端口映射中，登录密码、Cookie、文件内容和终端数据可能被旁路监听或篡改。

建议完成标准：默认只监听 `127.0.0.1`；启用局域网时明确提示“仅可信 LAN”；正式远程访问通过 HTTPS 反向代理或 VPN；提供受信代理和 HTTPS 部署文档；公网场景强制 Secure Cookie 和 HSTS。

### SEC-03 · P0 · 缺少 Host 白名单，存在 DNS Rebinding 攻击面

证据：

- `pkg/api/server.go:84-91` 将 `Origin == http(s)://r.Host` 视为同源；
- HTTP 服务没有验证 `Host` 是否为 loopback、Mac 局域网 IP 或用户显式配置的域名；
- 服务可监听 `0.0.0.0`，固定初始凭据又降低了攻击门槛。

影响：攻击者控制的域名若动态解析到 NAS 局域网地址，浏览器请求的 Origin 与 Host 仍然一致，现有来源检查无法识别这是 DNS Rebinding。固定默认凭据未修改时，恶意网页可能完成登录并调用管理 API。

建议完成标准：增加允许 Host 列表；默认只接受 loopback、当前局域网 IP 和显式配置域名；反向代理部署必须显式登记外部域名；增加 Host/DNS Rebinding 回归测试。

## 三、P1 高优先级项

### SEC-04 · 普通用户具有全部 NAS 数据的读取能力

`pkg/api/routes.go:104-117` 中目录列表、读取、下载、媒体预览和回收站列表只要求登录，不要求管理员；云盘挂载和文件列表也允许普通用户读取。服务端虽然把路径限制在 `/data`，但没有按用户、共享或目录设置 ACL。

如果产品定义是“家庭成员共享所有资料”，应在界面和文档明确说明；如果期望不同用户拥有私有目录，则当前权限模型不满足要求。建议引入共享级权限：管理员、只读成员、读写成员、私有目录所有者。

### SEC-05 · AI Skill 映射可选择几乎任意宿主机绝对目录

`pkg/config/config.go:239-257` 只拒绝相对路径和 `/`，不要求目录必须是 `.agents/skills`，也刻意不解析符号链接；`pkg/api/handlers_system.go:436-458` 只检查路径存在且为目录。虽然 VM 挂载为只读，但管理员误填 `/Users/用户名`、`.ssh` 或一个指向敏感目录的符号链接时，VM/AI CLI 仍可读取宿主机私密文件。

建议：默认仅允许自动扫描出的 `.agents/skills`、`.codex/skills`、`.claude/skills`；自定义路径必须二次确认并展示实际解析路径；拒绝主目录、`.ssh`、钥匙串、浏览器资料等敏感父目录；使用 `EvalSymlinks` 后再次校验。

### SEC-06 · 7z/RAR 解压依赖外部工具的路径安全行为

`pkg/terminal/files.go:758-778` 对 ZIP 做了目录穿越和符号链接检查；但 `pkg/terminal/files.go:832-881` 对 7z/RAR 直接以 VM root 调用 `7z/unrar/rar`，没有先枚举并验证归档条目。

影响取决于 VM 中工具版本及其对绝对路径、`../`、符号链接和覆盖文件的处理。建议把归档条目预检做成统一策略，拒绝绝对路径、父目录跳转、符号链接、设备文件和异常膨胀率；解压到临时目录，验证后再原子移动到目标目录。

### SEC-07 · 安装链与容器镜像缺少可重复供应链验证

- `templates/vm/macnas.yaml.tmpl:68-71` 在初始化时执行 `curl -fsSL https://get.docker.com | sh`；
- 社区商城从第三方 GitHub、镜像站和 CDN 获取目录，未进行签名验证；
- 多数 Compose 模板使用 `latest` 或普通 tag，而不是镜像 digest。

这不等于当前来源已被攻破，但会让同一个 Release 在不同日期安装出不同内容。建议固定 Docker 安装版本和校验和；社区目录增加签名；核心应用固定 digest 或至少固定版本 tag；在 UI 中显示镜像来源、维护者、更新时间和信任级别。

### SEC-08 · 限流和审计日志仍主要集中在登录接口

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
| 当前源码敏感信息模式扫描 | 未发现 API Key、私钥或云服务 Token；发现的固定控制台初始密码已列为 SEC-01 |

首次直接运行 Go 测试时，本机 Homebrew Go 1.27 的 cgo 未自动找到可用编译器；显式使用系统 `/usr/bin/clang` 后全部通过。这属于构建环境兼容问题，不是测试失败。

本机未安装 `govulncheck`、`gosec`、`shellcheck` 或 `gitleaks`，因此本轮未包含 Go 漏洞数据库、规则式静态扫描、Shell 规则扫描和完整 Git 历史秘密扫描。建议把这些工具放入 CI，并把结果作为 Release 门禁。

## 六、发布建议

可信家庭 LAN Beta 可以继续，但每次新安装都必须立即改掉 `admin123`，路由器不得做公网端口映射。公开 Release 前必须关闭 SEC-01、SEC-02、SEC-03；SEC-05、SEC-06、SEC-07 建议在扩大用户量前完成。当前版本不应宣传为可直接公网访问的 NAS 管理面板。
