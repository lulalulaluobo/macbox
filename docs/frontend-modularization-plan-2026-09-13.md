# MacNAS 前端拆包与模块化计划

日期：2026-09-13
范围：`web/` 前端工程
原则：不改变现有功能、接口、视觉样式和用户数据，仅调整加载方式与代码组织。

## 1. 当前基线

- TypeScript/TSX 源码约 15,893 行，`web/src/` 约 900 KB。
- 当前生产构建只有一个主要 JavaScript 文件，约 1.0 MB，gzip 后约 250 KB。
- `App.tsx` 静态导入全部主要页面，进入首页时会同时加载文件管理、Docker、应用商城、终端和设置代码。
- `TerminalPage` 依赖 xterm，但目前即使用户不进入终端页也会进入首屏包。
- 主要超大文件：

| 文件 | 当前规模 | 主要问题 |
| --- | ---: | --- |
| `pages/Settings.tsx` | 约 2,205 行 | 用户、SSH、终端、Skill、系统设置耦合 |
| `pages/storage/StorageSettings.tsx` | 约 1,536 行 | 磁盘、存储池、直通目录和 SMB 耦合 |
| `pages/storage/FileManager.tsx` | 约 1,157 行 | 文件状态、上传、传输、收藏和弹窗集中 |
| `pages/TerminalPage.tsx` | 约 1,069 行 | 会话、xterm、文件侧栏和布局集中 |
| `pages/apps/AppConfigInstallModal.tsx` | 约 611 行 | 表单、SSE 日志和部署状态集中 |
| `api.ts` / `types.ts` | 各约 500 行 | 不同业务领域共用单文件 |

## 2. 目标与验收标准

### 2.1 构建目标

- 首页不再加载 xterm、Docker 管理、应用部署和完整设置页代码。
- 每个一级页面形成独立异步 chunk。
- 主入口 JavaScript gzip 目标不超过 150 KB；若 React 与图标库仍占较大比例，可接受不超过 180 KB。
- 单个业务异步 chunk 原则上 gzip 不超过 150 KB；终端 chunk 可因 xterm 单独评估。
- 构建不再出现单个业务包超过 500 KB 的警告，或对不可避免的 vendor 包给出明确记录。

### 2.2 代码目标

- 一级页面组件原则上控制在 600 行以内。
- 新拆出的业务组件原则上控制在 300 行以内。
- 网络请求、业务状态与纯展示组件分离。
- API 和类型按业务领域组织，不改变后端接口和调用语义。
- 每个阶段都保持可独立构建、测试和提交，禁止一次性大重写。

## 3. 不在本次范围内

- 不引入新的路由框架或全局状态管理库。
- 不重做 UI，不调整颜色、间距和交互流程。
- 不修改 Go 后端 API。
- 不同时重构所有历史命名和样式类。
- 不为了减小包体替换 xterm、lucide-react 等现有成熟依赖。

## 4. 实施顺序

### 阶段一：一级页面懒加载

目标：用最小改动解决首屏一次加载全部功能的问题。

实施内容：

1. 保留 `Dashboard`、`LoginPage` 和初始化所需页面为同步加载。
2. 使用 `React.lazy()` 动态加载：
   - 文件与存储页面；
   - Docker 页面；
   - 应用商城页面；
   - Web 终端页面；
   - 设置页面；
   - 存储设置页面。
3. 在现有内容区域增加统一 `Suspense` 加载占位，不改变导航栏结构。
4. 页面切换失败时提供统一错误边界和“重新加载”入口，避免 chunk 获取失败后出现空白页。
5. 验证 Service Worker 更新后不会引用已经删除的旧 chunk。

验收：

- 首次打开首页的网络请求中不包含 xterm chunk。
- 点击终端页时才加载 xterm 和终端页面代码。
- 手机和桌面尺寸切换所有一级页面无白屏、无状态错乱。
- `npm run build` 输出多个页面 chunk。

建议提交：`refactor(web): lazy load feature pages`

### 阶段二：拆分 Settings 页面

目标：把最大的页面拆成独立设置模块，同时保持现有设置入口和视觉布局。

建议结构：

```text
pages/settings/
├── SettingsPage.tsx
├── SystemSettingsSection.tsx
├── UserManagementSection.tsx
├── SSHSettingsSection.tsx
├── TerminalSettingsSection.tsx
├── SkillMappingSection.tsx
├── PasswordChangeSection.tsx
├── hooks/
│   ├── useSystemSettings.ts
│   ├── useSSHSettings.ts
│   └── useTerminalSettings.ts
└── types.ts
```

拆分规则：

- 页面组件只负责分区布局和模块切换。
- 每个 section 自己处理表单状态，但 API 调用通过对应 hook 封装。
- SSH 私钥、密码等敏感值不放入共享全局状态，也不写入浏览器持久存储。
- 保存、失败和加载提示沿用当前文案和行为。

验收：用户管理、密码修改、SSH、终端身份、Skill 映射和系统设置逐项回归。

建议提交：`refactor(web): split settings feature modules`

### 阶段三：拆分 StorageSettings 页面

目标：隔离磁盘、存储池、本机直通和 SMB 的状态，降低初始化与挂载修改的回归风险。

建议结构：

```text
pages/storage/settings/
├── StorageSettingsPage.tsx
├── DiskPoolSection.tsx
├── ManagedDiskCard.tsx
├── LocalMountSection.tsx
├── LocalMountModal.tsx
├── SMBSharingSection.tsx
├── SMBShareModal.tsx
└── hooks/
    ├── useManagedDisks.ts
    ├── useLocalMounts.ts
    └── useSMBShares.ts
```

边界要求：

- 存储池刷新不能触发 SMB 和本机目录的无关重载。
- 本机目录读写切换、启停和删除保持现有安全确认。
- SMB 用户名继续跟随首位超级管理员，前端不得缓存管理员密码。
- 中文 SMB 共享名称的校验规则保持不变。

验收：对应手动测试清单中的初始化、扩展盘、本机直通和 SMB 项目全部复测。

建议提交：`refactor(web): modularize storage settings`

### 阶段四：收敛 FileManager 状态

目标：让文件浏览主组件只负责当前目录、选择状态和视图编排。

建议新增 hooks：

- `useFileNavigation`：路径、返回、刷新、磁盘与云盘切换；
- `useFileSelection`：点击选择、拖框多选、全选；
- `useFileUpload`：本地和夸克上传任务；
- `useFileOperations`：新建、改名、复制、移动、删除；
- `useFavorites`：仅处理文件夹收藏；
- `useTransferTasks`：云盘上传、下载及任务刷新；
- `useArchiveOperations`：仅保留 ZIP 压缩和解压。

约束：

- 不改变现有弹窗组件的外观。
- 不把 `File`、上传内容或大文本写入全局状态。
- 本地磁盘与夸克云盘必须使用明确的目标类型，禁止再次依赖当前标签推断上传目标。
- VM 路径、本机直通路径和云盘 ID 保持不同类型，避免字符串混用。

验收：增删改查、拖框多选、移动、复制、ZIP、收藏、大小文件上传下载和夸克任务逐项复测。

建议提交：`refactor(web): extract file manager workflows`

### 阶段五：拆分 TerminalPage

目标：隔离终端生命周期和文件系统侧栏，避免布局调整影响会话恢复。

建议结构：

```text
pages/terminal/
├── TerminalPage.tsx
├── TerminalViewport.tsx
├── TerminalToolbar.tsx
├── TerminalFileBrowser.tsx
├── TerminalInputBar.tsx
├── TerminalReconnectNotice.tsx
├── hooks/
│   ├── useTerminalSession.ts
│   ├── useTerminalViewport.ts
│   └── useVMFileBrowser.ts
└── types.ts
```

约束：

- `useTerminalSession` 独占 WebSocket 创建、重连、关闭和恢复逻辑。
- xterm 实例只在 `TerminalViewport` 生命周期内创建和销毁。
- VM 根目录浏览、隐藏文件开关和“终端进入此目录”由文件浏览 hook 管理。
- 手机软键盘、安全区和底部输入栏布局由 viewport hook 统一计算。
- 切换页面时明确决定“保留会话”还是“关闭视图”，不得隐式重复创建连接。

验收：普通用户/root 身份、VM 重启后重连、Claude/Codex、隐藏文件、根目录浏览、手机键盘和底部可见性全部复测。

建议提交：`refactor(web): isolate terminal session and file browser`

### 阶段六：拆分应用部署流程

目标：将部署表单和流式日志生命周期分离。

建议拆分：

- `AppInstallForm`：应用参数和端口校验；
- `AppInstallProgress`：SSE 日志及部署状态；
- `useAppInstallStream`：连接、消息解析、完成、失败和主动关闭；
- `AppInstallResult`：部署结果及用户手动关闭入口。

验收：拉取镜像时持续显示日志；成功后保留日志；只有用户点击关闭才退出；SSE 无完成事件断开时必须显示失败。

建议提交：`refactor(web): separate app install stream lifecycle`

### 阶段七：按领域拆分 API 与类型

目标：整理公共边界，避免形成新的大型公共文件。

建议结构：

```text
api/
├── client.ts
├── auth.ts
├── system.ts
├── storage.ts
├── samba.ts
├── docker.ts
├── apps.ts
├── cloud.ts
└── terminal.ts

types/
├── auth.ts
├── system.ts
├── storage.ts
├── samba.ts
├── docker.ts
├── apps.ts
├── cloud.ts
├── terminal.ts
└── index.ts
```

实施方式：先保留 `api.ts` 和 `types.ts` 作为兼容出口，再逐页迁移 import；全部迁移完成后删除旧实现，避免一次修改全站。

验收：API URL、HTTP 方法、请求体、返回类型、错误信息和未授权事件行为均不改变。

建议提交：`refactor(web): organize api and types by domain`

### 阶段八：Vite vendor 分包与体积门槛

此阶段必须在页面懒加载之后执行。建议根据构建分析结果分离：

- `react-vendor`：React 与 ReactDOM；
- `terminal-vendor`：xterm 及 addon；
- 图标库是否单独分包以实际压缩结果为准，不机械拆分。

增加轻量构建体积检查脚本，记录每个 JS chunk 的原始大小和 gzip 大小；超过约定阈值时在 CI 或发布检查中失败。

不建议一开始就配置复杂 `manualChunks`，否则可能制造跨 chunk 循环和无效的小文件。

建议提交：`build(web): enforce production bundle budgets`

## 5. 每阶段统一验证流程

每个阶段完成后都执行：

```bash
cd web
npm run build
npm audit --audit-level=low
```

同时执行：

1. 桌面宽屏基本导航；
2. 手机尺寸基本导航；
3. 登录、退出和会话过期；
4. 浏览器强制刷新；
5. Service Worker 有旧版本缓存时的升级；
6. 浏览器控制台无新增错误；
7. Network 面板确认页面 chunk 按需加载；
8. 对应功能章节的手动测试清单回归。

阶段一、四、五、六属于高风险阶段，应额外执行 Playwright 冒烟测试；阶段二、三、七以功能回归为主。

## 6. 推荐提交与发布策略

- 每个阶段单独提交，不把功能开发混入重构提交。
- 阶段一完成后即可先发布一次，验证真实设备缓存和懒加载行为。
- 阶段二至六可以逐模块推进，不要求一次全部完成。
- 阶段七只整理模块边界，不改变请求协议。
- 全部完成后重新截图 README 主要页面，但页面视觉没有变化时无需重复截图。
- 若某阶段出现难以定位的线上回归，直接回退该阶段提交，不连带回退其他模块。

## 7. 推荐执行优先级

1. 一级页面懒加载；
2. TerminalPage；
3. Settings；
4. StorageSettings；
5. FileManager；
6. 应用部署流程；
7. API 与类型领域化；
8. vendor 分包与体积门槛。

这个顺序优先获得首屏性能收益，并先隔离终端这一体积大、生命周期复杂的模块；其余页面按维护风险逐步拆分。

## 8. 本轮实施记录（2026-09-13）

已完成并验证：

- 一级页面懒加载、统一加载占位和 chunk 失败恢复入口；
- Terminal 会话生命周期、文件浏览器和文件弹窗拆分；
- FileManager 的导航、选择和收藏 hook 拆分；
- SMB 共享区拆分为独立展示模块；
- 应用部署 SSE 流程拆为 `useAppInstallStream`，部署完成后的日志仍由用户手动关闭；
- API 与类型按领域拆分，并保留 `api.ts`、`types.ts` 兼容出口；
- Vite `react-vendor`、`terminal-vendor` 分包及 JS gzip 体积检查脚本。

当前构建验证：

```bash
cd web
npm run build:verify
```

当前主入口约 80 KB raw / 21 KB gzip；终端业务代码约 30 KB raw / 10 KB gzip，xterm 单独为约 334 KB raw / 85 KB gzip；所有 JavaScript chunk 均通过 180 KB gzip 门槛。Settings、StorageSettings 和 FileManager 仍保留部分页面级状态，后续可继续按本计划逐块迁移，避免一次性重写造成线上回归。
