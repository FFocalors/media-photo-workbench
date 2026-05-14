# Media Photo Workbench / 融媒体图片工作台 - 路线图

## 当前阶段状态

项目正在进入 Phase 5B：Socket.IO 实时同步。当前代码已经能导入 JPG/JPEG，生成缩略图和预览图，从 SQLite 读取真实图片墙，支持基础选片操作、单张原图/预览图/已修图下载接口，并已接入图片变更的实时广播基础能力。

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

## 下一步

### Phase 5C：局域网客户端上传与协作
- 客户端上传 JPG。
- 多端状态同步。
- 批量下载和客户端侧下载流程完善。

### Phase 6：修图流转
- 待修包生成。
- `edit_manifest.json`。
- 已修图回传。
- manifest 优先匹配，文件名兜底匹配。

### Phase 7：导出与归档
- 发布导出规格：原尺寸、长边 3000px、长边 1920px。
- ZIP 生成。
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
