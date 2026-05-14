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
- **0.9.0**：远程传输预留
- **1.0.0**：第一个可用于实际活动的稳定版本

---

## [未发布] (Unreleased)

### 新增
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
- 客户端上传支持摄影师、设备名和备注字段，使用 `file_hash` 去重，重复计入 `skipped`。
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
- 导入流程使用 sha256 `file_hash` 去重，重复图片计入 `skipped`。
- 前端图片导入页接入真实活动、文件夹选择、扫描结果、导入结果和失败提示。
- 新增 `idx_images_file_hash` 索引用于导入去重查询。
- 新增 `GET /api/events/:eventId/images`，支持分页、星级、状态、来源和关键字筛选。
- 新增 `GET /api/images/:id/thumb` 和 `GET /api/images/:id/preview`，按图片 ID 返回缩略图和预览图文件。
- 新增图片星级、状态、分类、备注更新 API，并写入 `operation_logs`。
- 前端图片墙接入真实 `images` 表，展示真实缩略图和预览图。
- 图片预览弹窗保留打星、状态流转、左右切换和关闭快捷键。

### 修复
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
- `export_jobs` 复用为待修包记录表，待修包记录使用 `type = edit_package`。
- 客户端图片墙复用主机图片墙能力，但隐藏主机专属的图片逻辑删除入口。
- 新增 `DELETE /api/events/:id` 作为活动逻辑删除接口，只标记 `status = deleted`，不删除文件。
- 新建活动默认状态从 `draft` 调整为 `active`。
- `PATCH /api/settings/repository` 会拒绝空路径，并返回保存后的仓库检查结果。
- 活动创建流程改为先校验仓库并创建 `working/{event_slug}` 标准目录，再写入 SQLite。
- 活动工作区内部目录改为中文命名，例如 `原图/主机导入`、`缩略图`、`预览图`、`已修图`、`导出/发布图`、`清单`。

### 计划实现
- 将图片导入升级为任务队列和进度轮询。
- 将待修包生成和大批量已修图回传升级为任务队列和进度轮询。
- 补齐批量下载和客户端侧批量下载流程。
- 补齐活动回收站与永久删除流程：查看已删除活动、恢复活动、二次确认后永久删除活动记录、图片记录和工作区文件。
- 补齐图片回收站、恢复图片和永久删除图片文件流程。

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
