# 变更日志 (Changelog)

所有针对 Media Photo Workbench (融媒体图片工作台) 的显著修改都会记录在此文件中。

本项目遵循 [语义化版本控制 (Semantic Versioning)](https://semver.org/lang/zh-CN/) 规范。

## 版本演进路线图

- **0.1.0**：前端静态页面与基础后端骨架
- **0.2.0**：活动管理和仓库目录
- **0.3.0**：图片导入与缩略图
- **0.4.0**：图片墙真实数据与选片
- **0.5.0**：局域网客户端协作
- **0.6.0**：修图流转
- **0.7.0**：导出发布
- **0.8.0**：活动归档
- **0.9.0**：回收站、恢复、永久删除
- **0.10.0**：任务队列与批量 ZIP 下载
- **0.11.0**：归档活动只读打开
- **0.11.5**：修图协作与导航流程优化
- **0.12.0**：真实局域网 / 手机网页 / 多设备测试修复
- **0.13.0**：Windows 打包发布
- **0.14.0-rc**：真实活动压力测试与问题修复
- **1.0.0**：第一个可用于实际活动的稳定版本
- **1.1.0 之后**：远程传输预留 / 远程连接探索

---

## [未发布] (Unreleased)

### 新增
- v0.11.5-dev 修图协作与导航流程优化。
- `POST /api/events/:eventId/edit-package` 支持 `splitMode = count` 和 `splitMode = custom`，可将待修图生成单包、平均拆分为多个包，或按图片内容和人员分工自定义分包。
- 自定义分包支持包名和指定图片 ID；空包名、空图片列表会返回明确错误，不存在、跨活动、已删除或非待修图的图片会进入 errors；重复分配图片第一版允许但会返回 warnings。
- 待修包 manifest 增加 `package_id`、`package_name`、`package_index`、`package_total`，每个 ZIP 仍包含 `edit_manifest.json`、`待修原图/` 和 `已修图回传/`。
- 新增 `GET /api/events/:eventId/edit-packages`，主机和客户端均可读取活动已生成的待修包列表。
- 主机修图流转页新增“一包 / 平均拆包 / 自定义分包”三种生成模式，自定义分包支持创建包、命名包、点击待修图加入或移出当前包，并提示未分配图片数量。
- 主机和客户端待修包列表显示自定义包名；旧包没有包名时继续显示“第 x / y 包”或“待修包”。
- 新增 `DELETE /api/edit-packages/:packageId`，主机端可删除已生成待修包 ZIP 和对应 `export_jobs` 记录，不影响待修图片或原图。
- 主机修图流转页“已生成待修包”列表新增删除按钮，使用项目统一确认弹窗；客户端仍只能下载和回传，不能删除待修包。
- 客户端侧边栏新增“修图任务”，客户端可查看待修包列表、下载待修包，并拖拽“已修图回传”文件夹上传已修图。
- 主机侧边栏顺序调整为“首页、活动管理、导入图片、图片墙、待修图、已修图、导出发布、归档管理、系统设置”；客户端侧边栏顺序调整为“上传图片、图片墙、修图任务”。
- Vite 前端开发服务改为监听 `0.0.0.0:5173`，`pnpm dev` / `pnpm dev:web` 启动后同局域网设备可访问开发前端页面。
- `vite.config.ts` 固定 `server.port = 5173` 并启用 `strictPort`，避免前端开发端口漂移；后端 `3030-3040` 自动端口机制保持不变。
- 主机首页 / 系统概览页改为真实数据驱动：读取 `/api/health`、`/api/settings`、`/api/repository/check` 和活动列表，不再显示 mock 活动、假容量、假局域网地址或假二维码。
- `/api/health` 新增 `network` 字段，返回非回环 IPv4 局域网地址列表和 Windows 热点候选地址 `192.168.137.1`。
- 系统概览页新增地址复制按钮，显示本机 API、过滤后的局域网 API 和前端开发访问候选地址。
- 主机首页局域网地址列表过滤虚拟网卡，只显示 WiFi/WLAN 和以太网可用地址，不再展示 VMware、Docker、WSL 等虚拟网卡地址。
- v0.11.0-dev 归档活动只读打开。
- 归档策略调整为轻量归档：新生成归档只复制缩略图和 metadata，原图、已修图、导出文件只记录历史路径，不再默认复制进 `archive`。
- 新增 `GET /api/archived-events/:id`，根据 `archived_events.id` 读取归档活动详情。
- 新增 `GET /api/archived-events/:id/thumb/:imageId`，用于只读归档页访问归档缩略图。
- 新增 `DELETE /api/archived-events/:id`，支持二次确认后删除归档目录和归档摘要。
- 归档详情会读取 `archive_path` 下的 `缩略图`、`metadata/manifest.json`、`images.csv`、`operation_logs.csv` 和 `event.db` 文件状态。
- 归档详情返回活动基本信息、归档路径、归档时间、缩略图计数、缺失文件、metadata 文件状态和图片元数据列表。
- 归档页新增“只读归档”模式，可查看已归档活动列表和只读详情，并支持打开归档目录。
- 归档页只读模式新增缩略图墙和“删除归档”入口。
- 活动回收站永久删除会清理该活动的 working 目录、所有匹配的 archive 目录、图片记录、图片标签关联、下载日志、导出任务、操作日志和归档摘要。
- 只读归档详情不提供打星、状态修改、上传、删除、导出或修图回传入口。
- v0.10.0-dev 任务队列与批量 ZIP 下载。
- 新增内存任务管理器 `src-server/services/tasks.ts`，支持任务创建、更新、完成、失败、查询和取消占位。
- 新增 `GET /api/tasks`、`GET /api/tasks/:taskId`、`POST /api/tasks/:taskId/cancel`；当前取消接口明确返回 `TASK_CANCEL_NOT_SUPPORTED`。
- Socket.IO `task-updated` 已接入真实任务，任务状态变化会实时推送到前端。
- 主机端和客户端新增侧边栏任务中心，显示进行中任务、最近完成任务、失败任务、进度条、错误列表和下载入口。
- 新增 `POST /api/events/:eventId/download/zip`，支持按选中图片创建批量 ZIP 下载任务。
- 批量 ZIP 下载支持 `original`、`preview`、`edited`、`best` 四种类型，`best` 会优先使用已修图，缺失时回退原图。
- 新增 `GET /api/download-packages/:packageId/download` 下载批量 ZIP，并写入 `download_logs` 和 `operation_logs`。
- 图片墙新增“下载所选 ZIP”，创建任务后在任务中心查看进度和下载结果。
- 发布导出和活动归档 prepare 增加轻量任务记录，不改变原有接口返回。
- Phase 9 回收站 / 恢复 / 永久删除闭环。
- 新增 `GET /api/events/:eventId/images/trash`，支持查看活动图片回收站。
- 新增 `PATCH /api/images/:id/restore`，支持恢复已逻辑删除图片。
- 新增 `DELETE /api/images/:id/purge`，仅允许永久删除回收站图片，并清理原图、缩略图、预览图和已修图文件。
- 新增 `GET /api/events/trash`，支持查看活动回收站。
- 新增 `PATCH /api/events/:id/restore`，支持恢复已逻辑删除活动。
- 新增 `DELETE /api/events/:id/purge`，仅允许永久删除 `status = deleted` 的活动，默认清理 working 工作区、对应 archive 归档目录和主库记录。
- 活动管理页新增回收站入口，支持恢复活动和输入活动名称二次确认后永久删除。
- 图片墙新增主机端图片回收站入口，支持批量恢复和二次确认永久删除。
- Phase 8 活动归档闭环。
- 新增 `POST /api/events/:eventId/archive/prepare`、`POST /api/events/:eventId/archive/verify`、`POST /api/events/:eventId/archive/cleanup`。
- 归档会生成 `archive/{event_slug}`，当前策略只复制缩略图并生成 `manifest.json`、`images.csv`、`operation_logs.csv` 和独立 `event.db`。
- 归档验证通过后才允许清理 working 工作区，清理后活动状态更新为 `archived` 并写入 `archived_events` 摘要。
- Phase 7 导出发布闭环。
- 新增 `POST /api/events/:eventId/export`，支持手动选择、可发布、已修图、4 星及以上四种导出来源。
- 发布导出优先使用已修图，缺失时回退原图；原图和已修图都缺失时跳过并记录 errors。
- 发布导出支持原尺寸、长边 3000px、长边 1920px，以及 JPEG 质量 1-100 校验。
- 发布导出新增独立 10MB 限制选项，用于适配秀米等平台；JPEG 质量不再和 80 / 10MB 强关联，未超过 10MB 的原尺寸文件不重压缩。
- 每次导出生成独立 `导出/发布图/{timestamp}` 目录，发布 ZIP 保存到 `导出/压缩包`。
- 新增 `GET /api/exports/:jobId` 和 `GET /api/exports/:jobId/download`。
- 发布 ZIP 下载成功后写入 `download_logs` 和 `operation_logs`。
- 导出完成后广播 `export-created`。
- 导出发布页接入真实活动、导出设置、10MB 限制选项、结果展示、ZIP 下载和打开导出目录。
- Phase 6 修图流转闭环。
- 新增 `POST /api/events/:eventId/edit-package`，可将 `status = edit` 的图片生成待修包 ZIP。
- 待修包包含待修原图、`edit_manifest.json` 和 `已修图回传` 文件夹，保存到活动工作区 `导出/压缩包`。
- 待修包 ZIP 文件名改为中文前缀 `待修包_...zip`，包内新增 `已修图回传/edit_manifest.json` 和 `已修图回传/请把修好的JPG放在这里.txt`。
- 新增 `GET /api/edit-packages/:packageId/download`，下载待修包并写入 `download_logs` 和 `operation_logs`。
- 新增 `POST /api/events/:eventId/edited/upload`，支持上传已修图和可选 `edit_manifest.json`。
- 已修图回传优先按 manifest 匹配，失败时按文件名兜底匹配；成功后保存到 `已修图`，更新 `edited_path` 和 `status = edited`，并广播 `image-updated`。
- 已修图回传不生成额外逐图标记文件；完全无关改名不保证匹配，需依赖 `edit_manifest.json` 或保留原文件名主体。
- 同一图片重复回传已修图时，旧已修图文件会被清理，仓库只保留最新版本。
- 已修图回传成功后重新生成缩略图和预览图，图片墙与预览弹窗显示最新已修版本。
- 修图流转页接入真实数据，支持生成待修包、下载待修包、拖拽上传 `已修图回传` 文件夹和查看匹配结果。
- Phase 5C 局域网客户端协作闭环。
- 客户端连接页接入真实 `GET /api/health`，支持输入主机地址、最近连接、连接失败提示和连接状态展示。
- 客户端模式保存远程 API Base URL，活动列表、图片墙、下载、上传和 Socket.IO 都使用当前主机地址。
- 新增客户端工作区布局和客户端上传页。
- 新增 `POST /api/events/:eventId/upload`，支持 multipart 多文件 JPG/JPEG 上传。
- 客户端上传复用现有图片处理管线，保存到 `原图/客户端上传`，生成 WebP 缩略图/预览图，读取 EXIF，写入 `images`，并广播 `image-created`。
- 客户端上传支持摄影师、设备名和备注字段，使用 `event_id + file_hash` 在同一活动内去重，重复计入 `skipped`。
- Phase 5B Socket.IO 实时同步基础能力。
- 后端新增 Socket.IO 服务，复用当前 Express HTTP server 端口，兼容 3030-3040 自动端口机制。
- 新增实时广播模块，提供 `image-created`、`image-updated`、`image-deleted-logical` 和 `task-updated` 事件入口。
- 主机本地导入成功后广播 `image-created`；图片星级、状态、分类、备注更新后广播 `image-updated`；图片逻辑删除后广播 `image-deleted-logical`。
- 前端新增集中式 Socket.IO Client 封装，图片墙监听实时事件并执行局部插入、局部更新和局部移除。
- 图片墙顶部新增实时同步状态：实时已连接、重连中、实时已断开。
- Phase 5A 修补：图片文件状态检测与图片逻辑删除。
- `images` 表新增 `is_deleted`、`deleted_at` 字段，并在启动时自动迁移旧库。
- 图片查询结果新增 `original_exists`、`thumb_exists`、`preview_exists`、`edited_exists`、`is_deleted`、`deleted_at` 字段。
- 新增 `DELETE /api/images/:id`，支持图片墙逻辑删除，删除后默认图片查询不再返回。
- 图片墙新增“删除所选”功能，删除前二次确认。
- 图片卡片、元数据面板和预览弹窗增加文件状态提示；原图缺失时显示“原图缺失”并禁用原图下载。
- Phase 5A 单图下载能力。
- 新增 `GET /api/images/:id/download/original`，支持按图片 ID 下载原图。
- 新增 `GET /api/images/:id/download/preview`，支持按图片 ID 下载 WebP 预览图。
- 新增 `GET /api/images/:id/download/edited`，为已修图下载预留接口；暂无已修图时返回 `EDITED_IMAGE_NOT_AVAILABLE`。
- 图片下载成功后写入 `download_logs`，并写入 `operation_logs` 的 `image_downloaded` 记录。
- 图片查询结果新增 `edited_available` 字段，用于前端判断已修图下载按钮状态。
- 预览弹窗接入下载原图、下载预览图和已修图下载占位按钮。
- 图片卡片接入单张原图下载按钮。
- Phase 4 真实图片墙与基础选片。
- Phase 3 主机本地图片导入基础管线。
- 新增 `POST /api/events/:eventId/import/scan`，支持非递归扫描本地 JPG/JPEG 文件夹。
- 新增 `POST /api/events/:eventId/import/start`，支持同步导入主机本地图片。
- 导入流程复制原图到 `原图/主机导入`，通过 `sharp` 生成 `缩略图` 和 `预览图` WebP 文件，并通过 `exifr` 尝试读取 EXIF。
- 导入流程使用 sha256 `file_hash` 在同一活动内去重，重复图片计入 `skipped`。
- 前端图片导入页接入真实活动、文件夹选择、扫描结果、导入结果和失败提示。
- 新增 `idx_images_file_hash` 与 `idx_images_event_hash` 索引用于导入去重查询。
- 新增 `GET /api/events/:eventId/images`，支持分页、星级、状态、来源和关键字筛选。
- 新增 `GET /api/images/:id/thumb` 和 `GET /api/images/:id/preview`，按图片 ID 返回缩略图和预览图文件。
- 新增图片星级、状态、分类、备注更新 API，并写入 `operation_logs`。
- 前端图片墙接入真实 `images` 表，展示真实缩略图和预览图。
- 图片预览弹窗保留打星、状态流转、左右切换和关闭快捷键。

### 修复
- 修复图片导入去重范围过大的问题：`file_hash` 去重现在只在同一活动内生效，不同活动可以导入同一张图片。
- 修复旧 SQLite 库升级到图片逻辑删除字段时，`idx_images_deleted` 先于字段迁移执行，导致后端服务启动失败的问题。
- 修复运行中的旧后端尚未返回文件状态字段时，前端把 `undefined` 误判为文件缺失，导致图片墙全部显示“原图缺失/预览图缺失”的问题。
- 修复图片墙批量操作菜单悬浮后难以点击菜单项的问题，改为点击展开的受控菜单。
- 取消图片墙双击预览分支，保持单击缩略图直接打开预览；批量选择继续使用图片左上角勾选框和“全选当前”。
- 修复图片卡片选择框点击可能触发预览的问题，并让已选中图片持续显示对勾。
- 优化图片卡片状态标签，改为右上角单行显示，避免窗口较窄时显示不全。
- 修复右侧元数据面板在未选择当前图片时仍显示第一张图片的问题，关闭按钮现在可以清空面板。
- 修复活动管理页“...”按钮没有实际操作的问题；现在可切换活动状态并执行逻辑删除。
- 修复设置页仓库路径只保存在页面状态、切换页面后丢失的问题。
- 修复“检查可读写”反馈不明确的问题：当前只检查已保存仓库路径，未保存或为空时明确提示。
- 修复“打开文件夹”无法反馈 Electron `shell.openPath` 错误的问题。
- 修复新建活动可能先写数据库、但没有物理工作目录的问题；现在仓库未就绪时会阻止创建。

### 更改
- `export_jobs` 继续复用为导出任务表，发布导出记录使用 `type = publish`。
- `export_jobs` 复用为待修包记录表，待修包记录使用 `type = edit_package`。
- 客户端图片墙复用主机图片墙能力，但隐藏主机专属的图片逻辑删除入口。
- 新增 `DELETE /api/events/:id` 作为活动逻辑删除接口，只标记 `status = deleted`，不删除文件。
- 新建活动默认状态从 `draft` 调整为 `active`。
- `PATCH /api/settings/repository` 会拒绝空路径，并返回保存后的仓库检查结果。
- 活动创建流程改为先校验仓库并创建 `working/{event_slug}` 标准目录，再写入 SQLite。
- 活动工作区内部目录改为中文命名，例如 `原图/主机导入`、`缩略图`、`预览图`、`已修图`、`导出/发布图`、`清单`。

### 计划实现
- 将图片导入升级为任务队列和进度轮询。
- 将待修包生成、大批量已修图回传、归档清理和永久删除继续接入任务系统。
- 增加任务持久化、真正取消和重试能力。
- v0.12.0-dev：真实局域网 / 手机网页 / 多设备测试修复。
- v0.13.0-dev：Windows 打包发布。
- v0.14.0-rc：真实活动压力测试与问题修复。
- v1.1.0 之后再探索远程传输预留 / 远程连接。

---

## [0.2.0-dev] - 2026-05-11

### 新增
- **API 规范重构**：全面统一了后端的 API 响应格式，标准化为 `{ ok, data, error }` 结构。
- **端口高可用机制**：为后端启动增加了端口冲突自动探测与递增重试逻辑 (3030-3040)，并支持通过 Electron IPC 动态传递最终真实端口至前端。
- **活动业务全流程接入**：在服务端 `src-server` 实现了真实的 Events CRUD 业务服务层。
- **自动挂载工作区**：在新增活动时，自动读取本地配置的仓库路径，根据规范创建诸如 `原图`, `缩略图`, `预览图`, `已修图` 等 11 个标准的活动工作子目录。
- 前端 API Client 重写并强类型化，完全基于标准的 ApiResponse 进行错误捕获处理。
- 前端 Events 活动管理页面移除 Mock，完全接入真实 SQLite 数据库，并成功调通真实的新建活动与查询流程。
- **系统原生交互整合**：通过 Electron IPC（`dialog:select-directory`, `shell:open-path`）桥接，在前端设置页实现了调用原生文件夹选择框以及在资源管理器中直接打开仓库路径。

### 更改
- 对原有的 `/api/health`, `/api/settings`, `/api/repository` 接口进行了无缝重构以适配新的标准格式。
- `Settings.tsx` 增加异常处理兜底交互，不再静默容忍接口失败。
- `Events.tsx` 告别原生 `prompt`，实现了包含名称、日期、地点、描述的完整弹窗表单交互，并更新了更美观的空状态 UI。

## [0.1.0-dev] - 2026-05-11

### 新增
- 完成基于 Figma 设计的各类前端静态页面与基础组件搭建。
- 确立并初始化了基于 Electron + React + Vite + TypeScript + Tailwind 的全套桌面端前端工程。
- 构建了 `src-server` 独立的后端基础代码骨架。
- 成功在 Electron 主进程中以无缝嵌入方式集成启动本地 Express 服务。
- 引入并初始化 SQLite 本地数据库，创建了满足业务规范的 8 张核心数据表，并开启 WAL 模式提升并发性能。
- 实现了 `config/config.json` 系统参数的持久化配置机制。
- 实现了本地主机仓库路径真实性的检查接口（存在性及读写权限）。
- 深度集成了 `pino` 日志系统，实现稳定可靠的文件日志落盘。

### 更改
- 前端 Settings (设置) 页面完成升级，脱离早期 Mock 数据阶段，成功接入真实的本地后端 API 并具备异常降级能力。

### 修复
- 成功解决了 `better-sqlite3` 原生模块在 Electron 运行时出现的底层 ABI 兼容性崩溃问题（使用 `@electron/rebuild` 针对 `33.4.11` 重新编译）。
- 解决了因为没有 Visual Studio 环境导致原生模块编译报错的顽固阻碍。
- 解决了受限网络环境下的原生依赖包拉取超时问题（引入 `.npmrc` 使用 `npmmirror` 代理）。
- 将工程建议的 Node.js 运行环境降级对齐至生态最稳定的 v22.22.2 LTS。
