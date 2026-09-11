# MacNAS Sora Sky UI 与移动端适配

## Goal

将已确认的 `05 · Sora Sky` 视觉方向落到 MacNAS Web 控制台：以清爽浅色天空、粉蓝绿点缀、留白、轻量圆角和原创 NAS 伙伴感替换当前偏通用的深色/蓝色后台视觉，同时不破坏已有功能。随后补齐手机端浏览与 PWA 基础能力，让登录、首页、存储、Docker、应用、终端、设置在窄屏下可用。

## What I already know

* 用户已明确选择 `05 · Sora Sky` 作为主视觉方向，并要求继续实际修改 UI。
* 用户要求完成 UI 后调用 `/pwa` skill 增加手机移动端适配。
* 仓库实际位于 `/Users/luluen/ai-project/mac-nas`，运行服务为 Go backend + Vite React frontend。
* Web 入口为 `web/src/App.tsx`，全局样式为 `web/src/index.css`，主题逻辑为 `web/src/theme.ts`，顶栏为 `web/src/components/Navbar.tsx`。
* 页面包含首页、存储、Docker、应用、终端、设置；大量页面已使用 Tailwind utility class。
* 当前运行的服务二进制来自该仓库；`web/dist` 会被 Go `web/embed.go` 嵌入。
* 当前工作树存在其他开发者/此前工作产生的未提交改动，不能覆盖、回滚或纳入本任务提交。
* 仓库中没有可用的 `/pwa` skill 文件；本任务将按 PWA 基础约定手动实现 manifest、service worker 注册与静态资源缓存，并完成响应式移动端布局。

## Requirements

* 将默认主题调整为 Sora Sky 浅色视觉，保留用户可切换夜间模式的能力。
* 统一全局色板、背景、卡片、边框、按钮、状态标签、输入控件和焦点态：天空蓝、珊瑚粉、薄荷绿、柔和黄色，避免强渐变和过度深色。
* 调整品牌/导航壳，使桌面端接近 Sora Sky 原型：清爽顶栏、轻量导航、明确当前状态、留白充足。
* 保留所有已有业务文案、API 调用、交互、弹窗和状态逻辑；仅改变视觉与布局。
* 增加移动端导航折叠/展开，避免顶栏导航、状态和用户菜单在窄屏溢出。
* 移动端主内容使用安全边距和单列优先布局；指标、工具条、筛选器、表格/文件管理器、Docker 二级导航、终端区域和弹窗在 360px–430px 宽度下可操作。
* 触控目标保持可点击尺寸，横向内容只在确有必要的区域滚动，不让整页出现无意义的横向溢出。
* 添加 PWA 基础资源：web manifest、主题色/移动端 meta、service worker 注册与静态 shell 缓存；API 请求不得被 service worker 错误缓存。
* 构建并重新启动服务，使用桌面和手机 viewport 验证视觉、导航和核心页面可用性。

## Acceptance Criteria

* [ ] `npm run build` 通过，Go `go test ./pkg/...` 通过。
* [ ] 默认首次访问为 Sora Sky 浅色界面，切换夜间模式仍可用。
* [ ] 桌面端首页、存储、Docker、应用、终端、设置无明显布局回归。
* [ ] 360px、390px、430px 宽度下登录页和控制台可浏览，顶栏可切换页面。
* [ ] 移动端导航打开/关闭、用户菜单、主题切换和主要按钮可操作。
* [ ] `/manifest.webmanifest` 可访问，页面注册 service worker，静态资源缓存不拦截 `/api/` 与 WebSocket。
* [ ] 不修改或覆盖工作树中与本任务无关的已有脏文件内容。

## Definition of Done

* 前端类型检查与构建通过。
* 关键页面在真实运行服务上通过桌面/移动 viewport 检查。
* 变更范围和已知限制记录在任务/项目文档中。
* 代码变更按中文 commit 规范提交；不提交其他开发者已有未提交文件。

## Technical Approach

1. 以 `theme.ts` 增加显式视觉模式标记，令默认主题为 light/Sora Sky；夜间模式沿用现有 dark 分支。
2. 在 `index.css` 建立 Sora Sky token 层和受控 utility 覆盖，优先改变全局壳与共享控件，避免逐页重写业务逻辑。
3. 重构 `Navbar` 为桌面导航 + 移动端菜单按钮/抽屉，移动端保持当前 active tab 和用户操作入口。
4. 在 `App.tsx` 和 `index.css` 增加窄屏容器、modal、表格/终端等通用响应式规则。
5. 在 `web/public` 增加 `manifest.webmanifest`、`sw.js` 与原创简洁图标；在 `main.tsx` 注册 service worker。
6. 使用 Vite build 后重编译 Go 二进制，重启 19808 服务，进行浏览器验证。

## Out of Scope

* 不改后端 API、数据库、认证、Docker、Lima、Samba 业务逻辑。
* 不新增应用市场功能，不处理首页与 Docker 数据源不一致问题。
* 不把终端内容缓存到离线 PWA；离线只保证 shell 资源可打开，业务数据仍需在线。
* 不删除现有深色模式，不重构所有业务页面的组件树。

## Technical Notes

* 关键文件：`web/src/index.css`、`web/src/theme.ts`、`web/src/components/Navbar.tsx`、`web/src/App.tsx`、`web/index.html`、`web/src/main.tsx`。
* 嵌入链路：`web/dist` → `web/embed.go` → `bin/macnas`；修改前端后必须重新构建 Go 二进制才能影响 19808 服务。
* 相关规范：`.trellis/spec/frontend/*`（当前模板化，未提供额外强制约束）；`CLAUDE.md` 要求保留已有脏文件并使用 Git 管理。
