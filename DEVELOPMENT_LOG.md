# Media Photo Workbench / 融媒体图片工作台 - 开发记录

## 记录规范

每次开发完成后，请务必按照以下模板添加新的记录，以保持项目上下文的清晰，方便后续接手开发：

```markdown
### [阶段名称] (例如：后端第一阶段：基础骨架搭建)
- **日期**：YYYY-MM-DD
- **开发者 / 工具**：[你的名字 / 使用的 AI 工具]
- **完成内容**：
  - (列出完成的功能点)
- **修改文件**：
  - (列出核心新增或修改的文件路径)
- **验证方式**：
  - (如何测试和验证该功能)
- **遇到的问题**：
  - (遇到的技术阻塞或 bug)
- **解决方案**：
  - (对应的解决步骤和思路)
- **未完成事项**：
  - (本阶段原本计划但暂缓的功能)
- **下一步计划**：
  - (对下一个开发阶段的建议)
```

---

## 开发记录

### Phase 2 修复：仓库路径持久化与活动工作目录约束
- **日期**：2026-05-13
- **开发者 / 工具**：Codex
- **完成内容**：
  - 修复设置页仓库路径“浏览后只存在于页面 state”的问题：浏览只填入输入框，保存才写入后端配置，并在页面上明确显示“已保存路径”和“未保存更改”。
  - 设置页加载时通过 `GET /api/settings` 读取真实配置，保存后同步更新已保存路径，不再用 mock 状态伪装成功。
  - “检查可读写”改为检查已保存的仓库路径；未保存或为空时给出明确提示。
  - “打开文件夹”接收 Electron `shell.openPath` 的返回错误，并在前端提示路径不存在或无法打开。
  - 后端 `PATCH /api/settings/repository` 增加空路径校验，并保存 trim 后的真实路径。
  - 新建活动默认状态调整为 `active`，并且仓库未配置、路径不存在、不可读或不可写时直接返回错误，避免生成没有物理工作区的活动记录。
  - 新建活动成功前会创建 `working/{event_slug}` 下的原图、缩略图、预览图、修图、导出和清单目录。
  - 按最新使用要求，将活动工作区内部目录改为中文命名，例如 `原图/主机导入`、`缩略图`、`预览图`、`已修图`、`导出/发布图`、`清单`。
- **修改文件**：
  - `src/pages/host/Settings.tsx`
  - `src-server/routes/settings.ts`
  - `src-server/services/events.ts`
  - `src-server/routes/events.ts`
  - `src-server/db/schema.ts`
  - `electron/main.cjs`
  - `src/global.d.ts`
- **验证方式**：
  - 运行 `pnpm build` 验证前后端 TypeScript 与 Vite 构建。
  - 启动后端后，调用 `PATCH /api/settings/repository` 确认 `config/config.json` 写入。
  - 调用 `GET /api/settings` 确认返回上次保存的仓库路径。
  - 调用 `POST /api/events` 确认新建活动状态为 `active`，且仓库下生成完整 `working/{event_slug}` 中文业务目录结构。
- **遇到的问题**：
  - “浏览...”选择目录后仅更新前端输入框，未持久化到 `config/config.json`，切换页面后重新加载真实配置会回到旧值。
  - “检查可读写”检查的是已保存配置，而不是输入框里的临时路径，用户容易误以为新路径已经生效。
  - 旧逻辑允许在仓库未配置时先写入活动记录，再返回 `workingDir.created = false`，后续导入会缺少物理目录基础。
- **解决方案**：
  - 将设置页状态拆分为 `repositoryPath` 与 `savedRepositoryPath`，明确“未保存更改”。
  - 保存成功后同步刷新已保存路径，检查和活动创建均只基于已保存配置执行。
  - 活动创建改为先校验仓库并创建工作目录，目录创建成功后再写入 `events` 表。
- **未完成事项**：
  - 图片导入、缩略图生成、Socket.IO 和导出 ZIP 仍未进入本次修复范围。
- **下一步计划**：
  - 开始第三阶段前先在 Electron UI 中人工验证一次“保存仓库路径 -> 切页返回 -> 重启后仍存在 -> 新建活动目录生成”的完整链路。
  - 之后再进入图片导入扫描、复制、缩略图和预览图生成。

### 后端第一阶段：基础骨架搭建
- **日期**：2026-05-11
- **开发者 / 工具**：Antigravity (AI 智能体)
- **完成内容**：
  - 建立 `src-server` 后端独立目录，配置 TypeScript 将其编译为 CommonJS 格式。
  - 集成 Express 本地服务（运行在默认端口 3030）。
  - 实现 Electron 主进程在 `createWindow` 前安全启动本地后端服务。
  - 初始化 SQLite 数据库（使用 `better-sqlite3`），严格根据 `AGENTS.md` 规范创建 8 张核心表，并开启 WAL 高性能写入模式。
  - 实现 `config/config.json` 自动加载、降级与持久化保存机制。
  - 实现本地仓库（Repository）真实存在性及读写权限的检查接口。
  - 集成 `pino` 日志系统，将控制台输出同步落盘到本地 `logs/` 目录下。
  - 前端 Settings (设置) 页面完成改造，全面接入真实后端 API 并建立错误降级保护。
- **修改文件**：
  - 新增：`src-server/index.ts`, `src-server/app.ts`, `src-server/db/database.ts`, `src-server/db/schema.ts`, `src-server/config/config.ts`, `src-server/utils/logger.ts`, `src-server/utils/paths.ts`
  - 新增路由：`src-server/routes/health.ts`, `src-server/routes/settings.ts`, `src-server/routes/repository.ts`, `src-server/routes/events.ts`
  - 修改：`electron/main.cjs` (集成后端启动生命周期，并且汉化了原生顶部菜单栏)
  - 修改：`package.json`, `tsconfig.server.json` (增加构建脚本与依赖)
  - 修改：`src/pages/host/Settings.tsx`, `src/lib/api.ts`
- **验证方式**：
  - 运行 `pnpm dev` 完整启动流程（包含编译后端 -> Vite前端 -> Electron）。
  - 在 Electron 客户端内打开“设置”页，观察“服务状态”变为“API 已连接”。
  - 在设置页输入真实的本地目录路径点击“检查”，确认后端正确返回文件系统级的权限校验结果。
- **遇到的问题**：
  - `better-sqlite3` 安装时触发 C++ 本地编译（因为 Node 24 缺乏对应的官方预编译二进制），因系统无 Visual Studio 工具链而频繁失败。
  - 国内网络拉取原生模块预编译包（tar.gz）出现 Github 访问超时或连接被重置报错。
  - 安装成功后启动，报错提示 `NODE_MODULE_VERSION 127` 与 Electron 需要的 ABI `130` 不匹配（原生模块 Node 与 Electron 运行时差异导致崩溃）。
- **解决方案**：
  - 果断将 Node.js 环境从激进的 v24 降级到兼容性最好的 v22.22.2 LTS 版本。
  - 在项目中配置 `.npmrc` 引入 `npmmirror` 的二进制镜像代理，彻底解决国内拉包失败断联的问题。
  - 使用 `@electron/rebuild -v 33.4.11 -o better-sqlite3` CLI 工具，专门针对项目中采用的 Electron 33.4.11 版本，重新编译出匹配 ABI 130 的 SQLite 原生模块。
- **未完成事项**：
  - 真实的图片导入、缩略图生成 (sharp) 以及 ZIP 导出打包暂未在此基础设施搭建阶段进行。
- **下一步计划**：
  - 进入活动（Events）和图片库相关的业务逻辑开发阶段，实现活动的增删改查。

### 第二阶段：稳定性增强与活动管理 (Phase 2)
- **日期**：2026-05-11
- **开发者 / 工具**：Antigravity (AI 智能体)
- **完成内容**：
  - **API 标准化**：全面重构前后端 API，后端引入 `sendSuccess`/`sendError` 统一抛出 `{ ok, data, error }` 格式；前端使用泛型 `ApiResponse<T>` 封装。
  - **端口冲突自愈**：在 `index.ts` 中实现端口被占用时的自动探测与递增重试逻辑（尝试范围 3030-3040），将最终可用端口动态更新到 `config.json`。
  - **IPC 动态端口下发**：Electron `main.cjs` 捕获到实际运行端口后，通过 `webContents.send` 将端口动态传递给渲染进程的 `preload.cjs`，彻底解决前后端端口失联问题。
  - **活动 CRUD 实现**：在服务端建立 `services/events.ts` 业务层，基于 better-sqlite3 实现了针对 `events` 表的获取列表、查询单条、创建活动、更新信息及状态流转。
  - **自动建立物理工作区**：按照 `AGENTS.md` 规范，在新建活动时会校验 Repository 设置，自动在宿主本地硬盘创建 `working/{slug}/原图`、`缩略图`、`已修图` 等 11 个分类协作目录。
  - **移除前端 Mock 与交互完善**：前端 `Events.tsx` 取消静默报错机制，并实现了原生的新建活动弹窗表单；`Settings.tsx` 中对接 Electron 原生 IPC，实现了调用系统原生弹窗选择仓库路径（`dialog.showOpenDialog`）以及在资源管理器中打开对应目录（`shell.openPath`）。
- **修改文件**：
  - 新增：`src-server/utils/response.ts` (API 响应规范工具)
  - 修改后端：`src-server/index.ts`, `src-server/routes/health.ts`, `src-server/routes/settings.ts`, `src-server/routes/repository.ts`, `src-server/routes/events.ts`, `src-server/services/events.ts`
  - 修改 Electron 桥接：`electron/main.cjs` (增加 `dialog:select-directory` 与 `shell:open-path`), `electron/preload.cjs`
  - 修改前端：`src/lib/api.ts`, `src/global.d.ts`, `src/pages/host/Events.tsx`, `src/pages/host/Settings.tsx`
- **验证方式**：
  - 执行 `pnpm dev` 启动，观察控制台是否提示正确的启动端口（若开启多个实例，观察是否成功顺延到 3031 等端口）。
  - 在前端“活动管理”页面点击“新建活动”，填写信息后确认，体验完整的弹窗表单交互与错误校验提示。
  - 打开资源管理器，查看配置的 Repository 路径下是否成功生成 `working/{活动slug}/` 目录以及各级子目录。
  - 在前端“设置”页修改错误路径，验证界面是否能正确弹出 `alert` 后端报错。点击“浏览...”测试原生文件夹选择器，点击“打开文件夹”验证系统管理器拉起。
- **遇到的问题**：
  - 前端早期使用 Mock 数据和“如果抛错就返回 null 假装正常”的静默降级策略，掩盖了真实的 API 异常。
  - Electron 启动机制导致预加载脚本 `preload.cjs` 会在后端完全启动前先注入，写死端口可能引发连接失败。
- **解决方案**：
  - 前端彻底废弃静默 `null`，如果 `ok === false` 则将 `error.message` 显示给用户，提升业务透明度。
  - 主进程使用 `webContents.on('did-finish-load')` 及主动状态探测向前端补发真实的后端端口。
- **未完成事项**：
  - 图片文件 (Import) 的扫描、拷贝、sharp 裁剪尚未接入。
- **下一步计划**：
  - 进入第三阶段：实现图片本地目录扫描与大批量导入 (Import)，引入 `sharp` 生成符合规范尺寸的 WebP 缩略图与预览图。
