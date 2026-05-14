# Media Photo Workbench / 融媒体图片工作台 - 路线图

## 当前阶段状态

项目已完成 Phase 7：导出发布。当前代码已经支持主机本地导入、真实图片墙、基础选片、单图下载、Socket.IO 实时同步、客户端上传协作、修图流转，以及按可发布、已修图、4 星及以上或手动选择生成发布图和 ZIP 发布包。

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
- 使用 sha256 `file_hash` 去重，重复图片计入 `skipped`。
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
- 客户端上传使用 `file_hash` 去重，重复计入 `skipped`，成功后广播 `image-created`。

### Phase 6：修图流转
- `POST /api/events/:eventId/edit-package` 生成待修包。
- 待修包包含待修原图、根目录 `edit_manifest.json` 和内置同名 manifest 的 `已修图回传` 文件夹，保存到 `导出/压缩包`。
- `GET /api/edit-packages/:packageId/download` 下载待修包，并写入下载日志和操作日志。
- `POST /api/events/:eventId/edited/upload` 上传已修图。
- 已修图回传优先按 `edit_manifest.json` 匹配，失败时按文件名兜底匹配。
- 成功匹配后保存到 `已修图`，更新 `edited_path` 和 `status = edited`，并广播 `image-updated`。
- 同一图片重复回传时，旧已修图会被清理并由最新版本覆盖；回传成功后同步刷新缩略图和预览图。
- 修图流转页接入真实数据，支持生成、下载、拖拽上传 `已修图回传` 文件夹和匹配结果展示。
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

## 下一步

### Phase 8：活动归档
- 活动归档、归档验证、工作区清理。
- 归档活动只读打开。

### 待完善：活动回收站与永久删除
- 当前活动“删除”只做逻辑删除：`status = deleted`，图片仍归属于该活动，不删除工作区文件。
- 后续需要新增回收站入口，支持查看已删除活动、恢复活动。
- 后续需要新增永久删除流程，删除前明确展示图片数量和工作区路径，并要求二次确认。
- 永久删除应清理活动工作区文件、`images` 记录和 `events` 记录，避免孤儿图片或数据库指向不存在文件。
- 永久删除失败时必须有错误提示和日志，不能静默失败。

### 待完善：图片回收站与永久删除
- 当前图片墙“删除所选”只做逻辑删除：`images.is_deleted = 1`，不删除任何图片文件。
- 后续需要新增图片回收站入口，支持查看已删除图片、恢复图片。
- 后续需要新增永久删除流程，明确展示将删除的原图、缩略图、预览图和已修图路径，并要求二次确认。
- 永久删除应同时清理数据库记录和对应文件，避免孤儿文件或数据库指向不存在文件。

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
