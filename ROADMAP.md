# Media Photo Workbench / 融媒体图片工作台 - 路线图

## 当前阶段状态

项目已进入 v0.12.0-dev：窗口适配、真实压力测试与问题修复。当前代码已经支持主机本地导入、真实图片墙、基础选片、单图下载、Socket.IO 实时同步、客户端上传协作、修图流转、发布导出、活动归档、活动/图片回收站恢复和安全永久删除、统一任务中心、批量 ZIP 下载、working 清理后的历史归档只读查看、客户端下载待修包和回传已修图，并支持单包、平均拆包和按人员分工自定义待修分包。开发模式下 Vite 前端服务已监听 `0.0.0.0:5173`，当前重点是保证 Windows 桌面端非最大化窗口可用，并补齐真实活动压力测试中的问题。

## 已完成

### Phase 1：前端静态流程
- Electron + React + Vite + TypeScript + Tailwind 基础工程。
- 启动页、主机概览、客户端连接、活动管理、导入、图片墙、预览、修图、导出、归档、设置等主要页面。
- 图片墙筛选、选择、预览弹窗、快捷键等 Mock 交互。

### Phase 2：本地后端与活动管理
- Electron 主进程启动本地 Express 后端。
- SQLite 初始化，创建核心业务表并开启 WAL。
- `config/config.json` 配置读写。
- 后端默认端口 3030，并支持端口冲突时递增到 3040。
- Settings 页面接入真实 API 和 Electron 文件夹选择。
- Events 页面接入真实 SQLite，支持活动列表、创建、更新和状态变更。
- 活动管理页支持状态切换和逻辑删除，删除只标记 `deleted`，不删除文件。
- 新建活动会创建仓库工作目录。

### Phase 2 修复：仓库路径与活动工作区
- 仓库路径必须点击“保存”后才写入 `config/config.json`。
- 设置页重新进入时通过 `GET /api/settings` 读取真实已保存路径。
- 仓库检查只检查已保存路径，路径为空时明确提示。
- 新建活动默认 `active`。
- 新建活动前必须保证仓库路径存在、可读、可写。
- 新建活动成功前必须创建完整 `working/{event_slug}` 中文业务目录结构。

### Phase 3：图片导入基础
- 主机本地目录非递归扫描。
- 第一版只识别 JPG/JPEG。
- 导入时只复制原图，不移动、不删除、不覆盖。
- 复制到 `working/{event_slug}/原图/主机导入`。
- 使用 sha256 `file_hash` 在同一活动内去重，重复图片计入 `skipped`。
- 通过 `sharp` 生成 `缩略图/{imageId}.webp` 和 `预览图/{imageId}.webp`。
- 通过 `exifr` 尝试读取 EXIF，失败不阻断导入。
- 写入 `images` 表并更新活动图片总数。
- 前端导入页接入文件夹选择、扫描、开始导入和结果展示。
- `sharp` / `exifr` 依赖已安装并完成端到端验证。

### Phase 4：真实图片墙与基础选片
- `GET /api/events/:eventId/images` 接入 `images` 表，支持分页、星级、状态、来源和关键字筛选。
- `GET /api/images/:id/thumb` 和 `GET /api/images/:id/preview` 按 ID 返回真实 WebP 资源。
- 图片星级、状态、分类和备注支持真实更新，并写入 `operation_logs`。
- 前端图片墙不再使用 mock 图片，改为显示真实缩略图。
- 图片预览弹窗显示真实预览图，并保留选片快捷键。
- 状态在数据库中保存英文，前端按中文显示。

### Phase 5A：单图下载
- `GET /api/images/:id/download/original` 支持单张原图下载。
- `GET /api/images/:id/download/preview` 支持单张预览图下载。
- `GET /api/images/:id/download/edited` 预留已修图下载；没有已修图时返回 `EDITED_IMAGE_NOT_AVAILABLE`。
- 下载成功写入 `download_logs` 和 `operation_logs`。
- 预览弹窗接入下载原图、下载预览图、下载已修图占位按钮。
- 图片卡片接入单张原图下载按钮。
- 图片查询返回文件存在状态，原图缺失时图片墙显示明确标记。
- 图片墙支持逻辑删除所选图片，不删除仓库文件。

### Phase 5B：Socket.IO 实时同步基础
- 后端 Socket.IO 复用当前 Express HTTP server 端口，不单独开端口。
- 后端初始化实时同步模块，提供 `image-created`、`image-updated`、`image-deleted-logical`、`task-updated` 广播入口。
- 主机本地导入成功后广播 `image-created`。
- 图片星级、状态、分类、备注更新成功后广播 `image-updated`。
- 图片逻辑删除成功后广播 `image-deleted-logical`。
- 前端新增集中式 Socket.IO Client 封装，不在组件中直接 `new socket`。
- 图片墙监听实时图片事件，并对当前列表做局部插入、局部更新和局部移除。
- 图片墙顶部显示实时同步状态：已连接、重连中、已断开。

### Phase 5C：局域网客户端协作闭环
- 客户端连接页接入真实主机健康检查，支持主机地址、最近连接、连接状态和错误提示。
- 客户端模式保存远程 API Base URL，活动列表、图片墙、下载、上传和 Socket.IO 均使用当前主机地址。
- 客户端图片墙复用真实图片墙能力，支持查看、预览、打星、改状态、分类、备注、单图下载和实时同步。
- 客户端模式隐藏主机专属的图片逻辑删除入口。
- 新增 `POST /api/events/:eventId/upload`，支持 multipart 多文件 JPG/JPEG 上传。
- 客户端上传复用图片导入管线，保存到 `原图/客户端上传`，生成缩略图/预览图，写入 `images`，`source = client_upload`。
- 客户端上传使用 `file_hash` 在同一活动内去重，重复计入 `skipped`，成功后广播 `image-created`。
- 开发环境 Vite 前端服务固定监听 `0.0.0.0:5173`，后端 API 仍使用 `3030-3040` 自动端口机制，方便在同局域网设备访问前端页面并连接主机 API。

### Phase 6：修图流转
- `POST /api/events/:eventId/edit-package` 生成待修包，支持全部生成一个包、按 `packageCount` 平均拆分和 `splitMode = custom` 自定义分包。
- 自定义分包可指定包名和图片 ID，用于领导特写、舞台全景、观众互动、合影等人工分工场景。
- 待修包包含待修原图、根目录 `edit_manifest.json` 和内置同名 manifest 的 `已修图回传` 文件夹，保存到 `导出/压缩包`。
- 待修包 manifest 记录 `package_id`、`package_name`、`package_index`、`package_total`。
- `GET /api/events/:eventId/edit-packages` 返回活动已生成的待修包列表，主机和客户端均可读取。
- `GET /api/edit-packages/:packageId/download` 下载待修包，并写入下载日志和操作日志。
- `DELETE /api/edit-packages/:packageId` 允许主机端删除已生成待修包 ZIP 和对应记录，不影响待修图片、原图或已修图。
- `POST /api/events/:eventId/edited/upload` 上传已修图。
- 已修图回传优先按 `edit_manifest.json` 匹配，失败时按文件名兜底匹配。
- 成功匹配后保存到 `已修图`，更新 `edited_path` 和 `status = edited`，并广播 `image-updated`。
- 同一图片重复回传时，旧已修图会被清理并由最新版本覆盖；回传成功后同步刷新缩略图和预览图。
- 主机修图流转页接入真实数据，支持单包、平均拆包、自定义分包、逐包下载、拖拽上传 `已修图回传` 文件夹和匹配结果展示。
- 主机修图流转页支持删除已生成待修包；删除前使用项目统一确认弹窗。
- 客户端新增“修图任务”页，支持查看活动待修包列表、下载待修包、拖拽 `已修图回传` 文件夹并回传已修图。
- 不生成额外逐图标记文件；完全无关改名不保证匹配，需依赖 `edit_manifest.json` 或保留原文件名主体。

### Phase 7：导出发布
- `POST /api/events/:eventId/export` 生成正式发布图和发布 ZIP。
- 支持导出来源：手动选择图片、`status = publish`、`status = edited`、`rating >= 4`。
- 导出优先使用已修图，缺失时回退原图；两者都缺失时跳过并记录 errors。
- 支持导出规格：原尺寸、长边 3000px、长边 1920px。
- 支持 JPEG 质量 1-100，默认 90。
- 新增独立 10MB 限制选项，用于适配秀米等平台；开启后超过 10MB 的导出图才继续压缩，未超过 10MB 的原尺寸文件不重压缩。
- 每次导出创建独立目录 `导出/发布图/{timestamp}`，ZIP 保存到 `导出/压缩包`。
- `GET /api/exports/:jobId` 查询导出任务。
- `GET /api/exports/:jobId/download` 下载发布 ZIP，并写入下载日志和操作日志。
- 导出任务复用 `export_jobs`，`type = publish`。
- 导出完成后广播 `export-created`。
- 导出发布页接入真实 API，支持活动选择、来源选择、规格、质量、10MB 限制、命名规则、结果展示、ZIP 下载和打开导出目录。

### Phase 8：活动归档
- `POST /api/events/:eventId/archive/prepare` 生成活动归档目录。
- 归档采用轻量策略，只复制活动缩略图到 `archive/{event_slug}/缩略图`。
- 原图、已修图、导出发布图和压缩包不再默认复制进归档，只在 metadata 中记录历史路径和状态。
- 生成 `metadata/manifest.json`、`images.csv`、`operation_logs.csv` 和独立 `event.db`。
- `POST /api/events/:eventId/archive/verify` 验证归档文件存在性和 hash。
- `POST /api/events/:eventId/archive/cleanup` 在验证通过后清理 `working/{event_slug}`，更新活动状态为 `archived`，并写入 `archived_events` 摘要。
- 归档页接入真实流程，清理工作区前必须二次确认。

### Phase 9：回收站 / 恢复 / 永久删除
- `GET /api/events/:eventId/images/trash` 查看已逻辑删除图片。
- `PATCH /api/images/:id/restore` 恢复回收站图片，恢复后图片墙重新显示。
- `DELETE /api/images/:id/purge` 仅允许永久删除回收站图片，清理对应文件和 `images` 记录。
- 图片墙新增主机端回收站入口，支持批量恢复和二次确认永久删除。
- `GET /api/events/trash` 查看已逻辑删除活动。
- `PATCH /api/events/:id/restore` 恢复活动到 `active` 或 `draft`。
- `DELETE /api/events/:id/purge` 仅允许永久删除 `status = deleted` 的活动，默认删除 working 工作区、对应 archive 归档目录、活动图片记录、图片标签关联、下载日志、导出任务、操作日志、归档摘要和活动记录。
- 活动管理页新增回收站入口，永久删除前要求输入活动名称。

### v0.10.0-dev：任务队列与批量 ZIP 下载
- 新增内存任务管理器，提供 `pending`、`running`、`success`、`failed`、`cancelled` 状态。
- 新增 `GET /api/tasks`、`GET /api/tasks/:taskId`、`POST /api/tasks/:taskId/cancel`。
- 任务变化通过 Socket.IO `task-updated` 实时广播。
- 主机和客户端侧边栏新增任务中心，显示进行中、最近完成、失败任务、进度条、错误列表和下载入口。
- 新增 `POST /api/events/:eventId/download/zip`，按选中图片生成批量下载 ZIP。
- 支持批量下载类型：原图、预览图、已修图、最佳版本（优先已修图，否则原图）。
- 新增 `GET /api/download-packages/:packageId/download` 下载生成的批量 ZIP。
- 发布导出和归档 prepare 保持原接口返回不变，同时增加轻量任务记录和进度可见性。

## 当前阶段

### v0.12.0-dev：窗口适配、真实压力测试与问题修复
- Electron 主窗口最小尺寸调整为 `1200 x 760`，但布局不单纯依赖最小尺寸。
- 图片墙中窄窗口下折叠筛选栏和元数据栏，筛选栏改为抽屉，元数据栏在非宽屏下通过按钮打开，图片墙优先保留可用宽度。
- 图片墙顶部工具栏只保留搜索、筛选结果、实时状态、视图切换和入口按钮；选择当前、清除选择、回收站、删除所选、批量 ZIP 下载和批量状态操作收进“更多操作”菜单。
- 图片缩略图网格改为 `auto-fill + minmax`，避免固定列数在不同窗口宽度下造成挤压。
- 待修图自定义分包、已修图回传、客户端修图任务、客户端上传、导出发布和归档管理页面补充响应式栅格，避免 1200px 左右窗口下右侧栏挤压主内容。
- 第一版不做完整手机端适配；手机和平板只作为轻量访问入口，重点仍是 Windows 桌面端。

### v0.11.5-dev：修图协作与导航流程优化
- 主机可将待修图全部生成一个包、按包数量平均拆分，或手动创建多个自定义包并选择图片归属。
- 自定义包生成后 ZIP 文件名包含包名，manifest 记录 `package_name`，客户端可直接识别包名。
- 客户端可查看当前活动待修包列表并下载指定待修包。
- 客户端可拖拽“已修图回传”文件夹，复用现有 `edited/upload` 接口回传已修图。
- 回传成功后仍通过 Socket.IO `image-updated` 同步主机图片墙和其他客户端。
- 主机可删除误生成或过期的待修包；客户端不提供删除入口。
- 主机侧边栏将“导入图片”放到“图片墙”上方；客户端侧边栏调整为“上传图片、图片墙、修图任务”。

### v0.11.0-dev：归档活动只读打开
- 新增 `GET /api/archived-events/:id`，根据 `archived_events.id` 读取归档活动详情。
- 新生成的归档默认只保留缩略图和 metadata，不再保留原图、已修图或导出文件副本。
- 归档详情读取 `archive_path/缩略图`、`metadata/manifest.json`、`images.csv`、`operation_logs.csv` 和 `event.db` 文件状态。
- working 工作区清理后，仍可通过归档目录查看活动摘要、缩略图、文件计数、缺失文件和图片元数据。
- 归档页新增“只读归档”模式，展示已归档活动列表和只读详情；不提供打星、改状态、上传、删除、导出或修图回传入口。
- 归档页支持二次确认后删除归档目录和 `archived_events` 摘要。
- `ARCHIVE_PATH_NOT_FOUND` 和 `ARCHIVE_MANIFEST_NOT_FOUND` 会作为明确错误返回。

## 后续路线

- **v0.12.0-dev**：窗口适配、真实压力测试与问题修复。
- **v0.13.0-dev**：Windows 打包发布。
- **v0.14.0-rc**：真实活动压力测试与发布前问题修复。
- **v1.0.0**：第一个稳定可用版本。
- **v1.1.0 之后**：远程传输预留 / 远程连接探索。

### 后续任务系统增强
- 将导入、待修包生成、大批量已修图回传、归档清理和永久删除继续纳入统一任务模型。
- 增加真正取消、任务持久化和重试能力。

## 暂不做

- RAW/NEF/ARW/CR3/HEIC/视频处理。
- 云同步。
- 真正分布式同步。
- ngrok 或远程隧道强绑定。
- 复杂账号密码系统。

## 开源前检查

- 不提交 `data/`、`logs/`、`config/config.json`、真实图片、真实数据库。
- 保留 `config/config.example.json`。
- README 明确说明本项目是本地主机集中存储和局域网协作工具，不是云盘。
