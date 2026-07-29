# Media Photo Workbench / 融媒体图片工作台 - 路线图

## 当前阶段状态

当前进入 `v1.2.2` 异机测试阶段，主题为“现场传图稳定性与使用体验重构”。`v1.0.0-rc.1` 已作为预发布验证版本发布；`v1.1.0` 只作为内部开发节点，`v1.2.0-alpha.1` 的修复现已合并到 `main` 并形成内部测试包。

`v1.2.2` 当前只生成 Windows ZIP 便携包用于异机验证，不打 Tag、不创建 GitHub Release、不生成 NSIS 安装包。ZIP 文件名随 `package.json` 版本生成：

```text
MediaPhotoWorkbench-v1.2.2-x64.zip
```

稳定版 Release tag、标题和发布时间后续再定，本阶段不承诺。

### 功能冻结范围

`v1.2.2` 当前只纳入稳定性风险处理、相机 FTP 渐进式模块化、状态与提示统一、提权长任务恢复、数据安全、文档基线、自动回归测试和异机验证，仍不纳入以下大范围能力：

- 公网远程 FTP、FTPS / SFTP。
- 相机来源识别、现场接收看板和一键现场模式。
- 相机品牌 SDK 或相机自动配置。
- RAW / HEIC / 视频支持。
- AI 自动选片。
- 多 FTP 账户。
- 账号系统。
- 权限系统。
- NSIS 安装包。
- Web Installer。
- 云同步。
- 大 UI 重构。

当前相机 FTP 架构边界：

- 只保留 Windows IIS FTP 单一 provider；旧 Node.js `ftp-srv` 内置 Server 已废弃，不保留 fallback 或双 provider。
- IIS 控制端口默认 `21`，允许在 `1-65535` 范围内配置且不得落入被动端口范围；被动端口默认 `50000-50100`，站点 binding 为 `*:{当前控制端口}:`，不把热点 IP 写死进 binding。
- 配置使用独立的 `activeEventId` 表示唯一 FTP 接收活动；IIS 上传、原图最终存放和 watcher 目录统一为 `working/{event_slug}/原图/相机FTP/`，与前端当前查看活动相互独立。
- 同时支持相机和主机连接同一 Wi-Fi，以及相机连接 Windows 移动热点两种局域网方式；热点常见地址为 `192.168.137.1`，但以实时检测结果为准。
- Electron 普通启动不要求管理员权限；只有启用 Windows 功能、管理 IIS / 服务 / 防火墙 / 本地账户和 ACL 时才通过 UAC 提权。
- FTP 密码不明文写入 `config.json`、SQLite、日志或 API 响应，页面也不回显或复制密码。
- 继续复用 `camera_ftp` 文件稳定检测和图片导入管线，保留去重、缩略图 / 预览图、EXIF、SQLite、任务与 Socket.IO 行为。

当前 GitHub Release：

```text
https://github.com/FFocalors/media-photo-workbench/releases/tag/v1.0.0-rc.1
```

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
- 主机本地目录非递归扫描，并支持从文件夹中手动选择单张或多张图片文件导入。
- 当前识别 JPG/JPEG/PNG，仍不支持 RAW/HEIC/视频。
- 导入时只复制原图，不移动、不删除、不覆盖。
- 复制到 `working/{event_slug}/原图/主机导入`。
- 使用 sha256 `file_hash` 在同一活动内去重，重复图片计入 `skipped`。
- 通过 `sharp` 生成 `缩略图/{imageId}.webp` 和 `预览图/{imageId}.webp`。
- 通过 `exifr` 尝试读取 EXIF，失败不阻断导入。
- 写入 `images` 表并更新活动图片总数。
- 前端导入页接入文件夹选择、指定图片文件选择、扫描、开始导入和任务提交结果展示。
- 主机导入通过后台任务有限并发处理，任务中心显示总数、已处理、成功、跳过、失败、ETA 和取消入口。
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
- 新增 `POST /api/events/:eventId/upload`，支持 multipart 多文件 JPG/JPEG/PNG 上传。
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
- 主机和客户端侧边栏新增任务中心，显示进行中、最近完成、失败任务、进度条、错误列表和下载入口；v0.14 起导入任务补充已用时间、预计剩余时间和当前文件名。
- 新增 `POST /api/events/:eventId/download/zip`，按选中图片生成批量下载 ZIP。
- 支持批量下载类型：原图、预览图、已修图、最佳版本（优先已修图，否则原图）。
- 新增 `GET /api/download-packages/:packageId/download` 下载生成的批量 ZIP。
- 发布导出和归档 prepare 保持原接口返回不变，同时增加轻量任务记录和进度可见性。

## 历史阶段记录

### v0.13.2-dev：Windows ZIP 便携预发布版
- 生产模式下 Express 托管前端 `dist/`，浏览器访问 `http://localhost:{serverPort}` 或 `http://主机局域网IP:{serverPort}` 即可打开前端页面。
- API 继续统一使用 `/api` 前缀，Socket.IO 复用同一 HTTP server 端口。
- 开发模式继续使用 Vite `0.0.0.0:5173`；生产模式不再提示客户端访问 5173。
- Electron 生产模式使用可写的 `app.getPath("userData")` 保存 `data/app.db`、`config/config.json` 和 `logs/`，不写入只读安装目录。
- 配置 electron-builder，目标为 Windows 便携 ZIP 包和 NSIS 安装包，输出到 `release-pack/`。
- ZIP 便携包已验证可解压启动，并已发布到 GitHub Release；推荐交付物为 `MediaPhotoWorkbench-v0.13.2-dev-x64.zip`。
- 本机测试、多设备测试、压力测试和主机 Windows 热点连接测试已通过。
- 客户端访问方式为在主机首页复制局域网访问地址，或扫描主机首页二维码打开客户端页面。
- 校园网可能存在设备隔离；同 Wi-Fi 无法互访时，推荐使用主机 Windows 热点。
- 单文件 self-extract portable EXE 暂不作为推荐交付物；NSIS 安装包经 v0.14.0 初步验证发现安装进度卡住、取消按钮无响应，暂不推荐作为交付物。
- `better-sqlite3`、`sharp` 等原生依赖需要通过 Electron ABI 重建并在打包时 `asarUnpack`。
- `release/`、`release-pack/`、`release-win/`、`dist/`、`dist-server/`、`data/`、`logs/`、`config/config.json`、真实仓库、`working/`、`archive/` 和 ZIP 产物不提交 Git。

### v0.13.0-dev 验收重点
- `pnpm build` 通过。
- ZIP 便携包生成通过，解压后可启动 `Media Photo Workbench.exe`。
- 生产托管下根路径和 React Router 子路径刷新不 404。
- `/api/health`、缩略图、预览图、下载接口和 Socket.IO 不被前端静态回退拦截。
- `pnpm dist:portable` 能生成便携 ZIP 包，解压后运行 `Media Photo Workbench.exe`；`pnpm dist:win` 仅保留为后续 NSIS 评估入口，当前交付不依赖 NSIS 安装包。
- 打包后的 exe 能设置仓库、创建活动、导入 JPG/JPEG/PNG、生成缩略图/预览图、图片墙显示缩略图。
- 局域网客户端通过 `http://主机IP:{serverPort}` 访问前端，并可连接 API、上传 JPG/JPEG/PNG、下载待修包、回传已修图、执行导出和归档。

### v0.12.0-dev：窗口适配、真实压力测试与问题修复
- Electron 主窗口最小尺寸调整为 `1200 x 760`，但布局不单纯依赖最小尺寸。
- 图片墙中窄窗口下折叠筛选栏和元数据栏，筛选栏改为抽屉，元数据栏在非宽屏下通过按钮打开，图片墙优先保留可用宽度。
- 图片墙顶部工具栏只保留搜索、筛选结果、实时状态、视图切换和入口按钮；选择当前、清除选择、回收站、删除所选、批量 ZIP 下载和批量状态操作收进“更多操作”菜单。
- 图片缩略图网格改为 `auto-fill + minmax`，避免固定列数在不同窗口宽度下造成挤压。
- 待修图自定义分包、已修图回传、客户端修图任务、客户端上传、导出发布和归档管理页面补充响应式栅格，避免 1200px 左右窗口下右侧栏挤压主内容。
- 第一版不做完整手机端适配；手机和平板只作为轻量访问入口，重点仍是 Windows 桌面端。

### v0.12.0-dev 验收重点
- 窗口尺寸：1920x1080、1440x900、1366x768、1280x720、1200x760。
- 图片数量：50 张、300 张、500 张 JPG/JPEG/PNG，如条件允许覆盖不同相机和文件大小。
- 多端流程：主机端 + 浏览器客户端同时打开同一活动，验证打星、改状态、上传、待修包下载、已修图回传和 Socket.IO 实时同步。
- 长任务流程：批量 ZIP 下载、待修包生成、导出发布、归档 prepare/verify/cleanup，任务中心应显示进度、完成结果和错误列表。
- 不作为 v0.12 验收目标：远程传输、ngrok、FTP/SFTP、RAW/HEIC/视频、复杂账号权限、完整手机端工作流。

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

### v0.15.0-rc.0：发布候选版，导入性能与稳定性增强

- 已新增 PNG 图片支持：主机本地导入、客户端上传、WebP 缩略图/预览图、图片墙、原图下载、批量 ZIP 和待修包均兼容 PNG 原图；主机导入支持选择文件夹或手动多选图片文件；已修图回传仍限定 JPG/JPEG 成片。
- 已将主机导入和客户端上传后的图片处理接入任务系统，大批量导入不再阻塞单个长请求，任务中心显示进度、ETA、成功 / 跳过 / 失败统计和取消入口。
- 已优化导入管线：有限并发处理、同一批次内去重、预编译数据库语句、EXIF 失败降噪、任务错误列表上限，降低 4000 张级别导入时的处理和日志压力。
- 已补充关闭安全：后端关闭时请求取消运行中任务，导入日志写入使用安全封装，避免 `pino` / `thread-stream` worker 已退出后继续写日志导致 Electron 主进程错误弹窗。
- 图片墙分页修复：大图量活动不再只显示 200 张，可继续加载 / 翻页查看剩余图片，底部数量与实际总数一致。
- 归档清理工作区任务化：多图活动归档后的 `working` 清理改为后台任务，任务中心可查看进度，清理完成后归档页自动更新。
- 多客户端并发上传复测：重点验证多台笔记本同时上传 JPG/JPEG/PNG、去重范围、Socket.IO 同步和任务状态。
- 真实活动压力测试复核：用真实活动素材复测 50 / 300 / 500 张图片导入、图片墙滚动、待修包、导出发布、批量 ZIP 和轻量归档。

### v0.14.0：故障排查、连接诊断与 NSIS 初步验证

- 已新增系统设置页“故障排查 / 诊断信息”入口，支持打开日志目录和复制现场诊断信息。
- 已优化客户端连接失败提示，按地址格式错误、网络无响应 / 防火墙 / 校园网隔离、目标端口无服务和 API 健康检查失败分类展示排查建议。
- 主机首页已补充推荐连接顺序：优先使用 WLAN / 以太网地址，校园网不通时使用 Windows 热点，仍无法连接时复制诊断信息排查。
- 防火墙 / 热点 / 校园网连接排查提示覆盖同 Wi-Fi 不可互访、Windows 防火墙拦截、误填 `localhost`、校园网设备隔离和热点 `192.168.137.1` 场景。
- 一键打开日志目录：在设置页补充安全入口，便于用户定位运行日志，不直接暴露或修改业务数据。
- NSIS 安装包初步人工测试发现安装进度卡住、取消按钮无响应、需要强制结束进程；当前不作为发布候选阻塞项，ZIP 便携包仍是唯一推荐交付物。

## 后续路线

- **阶段一：建立 v1.2.0 开发基线**：统一为 `1.2.0-alpha.1`，清理过期版本/端口口径，记录重构前构建和自动测试结果，不改变 FTP 行为。
- **阶段二：统一系统状态真相与启动恢复模型**：明确 IIS/文件系统/SQLite 为事实、配置为目标、Node 为临时运行态、前端只负责展示；普通启动只读恢复合法 watcher。
- **阶段三：稳定性风险处理与故障注入测试**：覆盖 UAC、PowerShell、仓库、数据库、任务、广播、文件覆盖、重启补扫和部分回滚等异常，不修改真实 IIS。
- **阶段四：相机 FTP 前后端模块化重构**：保留 facade、路由和 API 兼容，每次只抽离一个职责并立即回归。
- **阶段五：统一状态、颜色、提示和错误展示**：只有真实失败使用红色，集中维护状态和错误语义，保持小窗口确认弹窗可用。
- **阶段六：重启恢复和数据安全（已完成）**：已补齐配置 schema/严格校验/原子写入、数据库迁移账本与 schema 漂移复核、高风险受控备份、回执生命周期、活动永久删除不可变 journal/隔离回滚/跨进程启动恢复、日志轮转、API/PowerShell 父子 operationId、白名单脱敏诊断和部分失败一致性。
- **下一轮现场验证**：六阶段完成后再执行压力测试和多设备接入测试；本轮不执行，只形成可操作的人工验收清单。

### 后续任务系统增强
- 继续评估大批量永久删除、更多文件级导出细节是否需要更细粒度任务进度。
- 增加任务持久化、重试能力和更细粒度的取消支持。

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
