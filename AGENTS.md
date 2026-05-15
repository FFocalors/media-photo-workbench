# Media Photo Workbench / 融媒体图片工作台：开发要求

## 0. 项目定位

本项目是面向校园融媒体中心、新闻中心、影像部门的 Windows 11 桌面端图片工作台。

系统覆盖活动图片的全流程管理：多设备导入、缩略图预览、选片、打星、分类、状态流转、修图任务分发、已修图回传、发布导出、活动归档、局域网多端协作。

核心目标：以一台主机为中心，集中保存图片和数据库，多台笔记本客户端协同上传、下载、选图、修图和发布。手机和平板通过网页轻量访问。

本项目不是实时传图系统，也不是普通网盘。

## 1. 产品形态

- 使用同一个 Windows 桌面软件安装包，启动后选择“启动为主机”或“连接到主机”。
- 主机负责活动、仓库、SQLite 数据库、原图/缩略图/预览图/已修图/发布图/归档包、局域网 API、网页访问、上传接收、下载、归档、远程传输入口预留。
- 客户端负责连接主机、上传 JPG、查看图片墙、打星、分类、修改状态、下载原图/待修包、上传已修图。
- 手机和平板只通过浏览器访问主机网页，做查看、预览、打星、状态、分类、简单筛选，不承担批量上传下载导出归档。

## 2. 技术栈

- 开发环境：Windows 11、VS Code、Codex、Figma、pnpm、Git。
- 桌面端：Electron、React、Vite、TypeScript、Tailwind CSS、React Router、Zustand。
- 本地后端：Node.js、Express、SQLite、better-sqlite3、sharp、exifr、chokidar、Socket.IO、archiver、fs-extra、pino。
- 数据库：SQLite，默认 `./data/app.db`，不放入图片仓库。

## 3. 存储设计

数据库默认位于软件目录：

```text
MediaPhotoWorkbench/
├── data/app.db
├── config/config.json
└── logs/
```

图片仓库路径由用户在设置中选择，必须支持查看、更改、打开文件夹、读写检查、剩余空间显示、路径失效提示。

建议仓库结构：

```text
MediaPhotoWorkspace/
├── working/event_slug/
│   ├── 原图/主机导入/
│   ├── 原图/客户端上传/
│   ├── 原图/远程导入/
│   ├── 缩略图/
│   ├── 预览图/
│   ├── 待修图/
│   ├── 已修图/
│   ├── 导出/发布图/
│   ├── 导出/压缩图/
│   ├── 导出/压缩包/
│   └── 清单/
├── archive/event_slug/
│   ├── 缩略图/
│   └── metadata/event.db
├── temp/
└── logs/
```

导入原则：只复制原图，不移动、不删除、不覆盖；同一活动内重复图片默认跳过并记录日志，不同活动允许导入同一张图片。

## 4. 图片格式

第一版只支持 JPG/JPEG。暂不支持 RAW、NEF、ARW、CR3、HEIC、视频。代码可预留扩展点，但不要实现 RAW。

## 5. 缩略图与预览图

每张导入图片生成：

- `original`：原始 JPG，用于修图、导出；轻量归档只记录其历史路径，不再默认复制原图。
- `thumb`：长边 400px，WebP，用于图片墙。
- `preview`：长边 1600px，WebP，用于预览弹窗。

图片墙只加载 thumb，预览弹窗加载 preview，原图只用于修图下载、发布导出、归档保存。

## 6. 数据库设计

初始化必须开启：

```sql
PRAGMA journal_mode = WAL;
```

所有客户端写入必须经过主机 Node 后端 API，禁止多个设备直接访问 SQLite 文件。

需要的表：

- `events`：活动，状态 `draft | active | reviewing | archived | deleted`。
- `images`：图片，状态 `unselected | rejected | archive | edit | edited | publish | published`，来源 `host_import | client_upload | remote_import | manual_import`。
- `tags`：标签。
- `image_tags`：图片标签关联。
- `operation_logs`：上传、下载、打星、改状态、改分类、加标签、导出、归档、上传已修图。
- `download_logs`：下载日志，类型 `original | preview | edited | zip | export`。
- `export_jobs`：导出任务。
- `archived_events`：归档活动摘要。

## 7. 文件命名与去重

保存文件名不得直接使用原文件名作为唯一名。建议：

```text
eventSlug_importTime_sourceDevice_originalFilename
```

数据库同时保存 `original_filename` 和 `stored_filename`。

第一版去重：文件大小 + 原文件名 + EXIF 拍摄时间快速判断；疑似重复时计算 hash；去重范围限定在同一活动内，重复跳过并写日志；不覆盖旧文件。

## 8. 用户与权限

第一版不做复杂账号密码。进入主机或客户端时填写姓名、角色、设备名。

角色：

- 管理员：创建活动、仓库路径、导入、导出、归档、清理、所有图片操作。
- 编辑：查看、打星、分类、改状态、下载、导出当前筛选。
- 修图：查看待修图、下载待修包、上传已修图、标记已修。
- 访客：查看图片和预览，不允许修改状态。

## 9. 前端页面要求

前端必须优先遵循 Figma 设计稿。没有设计稿时采用简约、高级、克制、浅色界面、低饱和蓝色主色、轻阴影、圆角卡片、线性图标、适合 Windows 11 桌面端的方向。不要做成手机 App 风格。

页面：

- 启动页：启动为主机、连接到主机、最近使用、设置；不要固定品牌图标，只保留组织 Logo 占位。
- 主机系统概览页：当前活动、仓库路径、数据库状态、剩余空间、服务状态、本机/局域网访问地址、二维码、快捷操作。
- 活动管理页：新建、打开、状态、已归档入口。
- 图片导入页：主机本地导入、客户端上传导入、远程传输预留；第一版只实现前两者。
- 图片墙页：缩略图网格、左侧筛选、顶部工具栏、右侧信息栏、批量操作、快捷键、打星、状态、分类、标签、下载、导出当前筛选。
- 图片预览弹窗：1600px preview、底部胶片条、右侧操作面板、星级、状态、分类、标签、备注、加入待修图、标记可发布、标记废片、下载原图。
- 修图流转页：待修图、待修包、`edit_manifest.json`、已修图上传、匹配原图、匹配失败记录。
- 导出发布页：当前筛选、4 星以上、可发布、已修图；原尺寸、长边 3000px、长边 1920px；JPEG 质量默认 90。
- 活动归档页：生成归档、验证归档、清理工作区、打开归档目录。
- 设置页：仓库路径、数据库路径、局域网端口、导入设置、导出设置、快捷键、关于。

预览快捷键：

```text
1-5：打星
0：清除星级
X：废片
E：待修图
P：可发布
← / →：上一张 / 下一张
Esc：关闭
```

## 10. 主机与客户端连接

主机启动后显示本机访问地址、局域网访问地址、二维码，例如：

```text
http://localhost:3030
http://192.168.1.23:3030
http://192.168.137.1:3030
```

后端主机服务默认端口使用 `3030`，避免占用常见的 `3000` 端口。

客户端支持输入主机地址、扫描二维码、最近连接、连接测试。

校园网可能存在设备隔离、跨网段限制、防火墙限制、同 Wi-Fi 不能互访。连接失败时提示检查同一局域网、主机软件、主机 IP、防火墙、校园网隔离。提示用户可使用 Windows 热点，常见主机 IP 为 `192.168.137.1`。

## 11. 多端协作

主机集中存储和管理，不做真正分布式同步。原则：导入可以分散，存储必须集中，下载可以多端。

Socket.IO 广播：

```text
image-created
image-updated
image-deleted-logical
task-updated
export-created
archive-updated
```

客户端上传流程：连接主机、选择活动、摄影师、设备、JPG/JPEG、上传主机、主机入库、生成缩略图/预览图、写 SQLite、广播新图片。

批量下载由主机生成 ZIP 后再提供下载。

## 12. 修图、下载、导出

待修包包含待修原图和 `edit_manifest.json`：

```json
{
  "image_id": "xxx",
  "original_filename": "IMG_3821.JPG",
  "export_filename": "IMG_3821.JPG"
}
```

已修图回传优先按 `edit_manifest.json` 匹配，失败时按文件名兜底。成功后写入 `edited_path`，状态改为 `edited`，记录日志并广播。

禁止覆盖原图，已修图单独保存到 `已修图` 目录；数据库字段仍使用 `edited_path` 记录路径。

下载是用户个人取文件；导出是系统生成正式结果。两者必须分开记录日志。

## 13. 发布导出

支持当前筛选、星级 >= 4、状态 = publish、状态 = edited、指定标签。导出规格为原尺寸、长边 3000px、长边 1920px。JPEG 质量默认 90，可配置。导出后生成 `export_jobs`。

## 14. 活动归档

每个活动结束后必须支持归档，主数据库不能无限写。

归档流程：生成轻量归档目录、复制缩略图、生成 `event.db`、`images.csv`、`operation_logs.csv`、`manifest.json`、验证缩略图和 metadata 完整性、用户确认后清理 `working`、主库保留 `archived_events` 摘要。

归档默认不长期保存原图、已修图、发布图或 ZIP，只在 metadata 中记录历史路径和业务状态。归档只读查看依赖缩略图和 metadata。归档目录支持二次确认后删除，用于释放长期占用空间。

归档活动支持只读打开。默认不允许修改归档活动。

废片策略默认保留全部图片，可选不归档废片或只保留已打星图片。

## 15. 远程传输预留

第一版暂不实现远程传输，但预留远程传输设置页、`remote_import` 目录、当前活动接收目录、协议字段 SFTP/FTP、隧道地址、端口、账号、状态。不要把 ngrok 写死进核心流程。

## 16. 任务与错误

导入、缩略图、导出 ZIP、归档都是耗时任务，必须有状态：

```text
pending
running
success
failed
cancelled
```

需要显示当前任务、总数量、已完成、成功、失败、跳过、错误详情、是否可重试。

失败记录必须包含文件名、原因、时间、任务 ID、是否可重试。

## 17. 开发顺序

必须遵循“先前端，再后端”。

前端阶段：

1. 根据 Figma 完成静态页面。
2. 使用 mock 数据。
3. 实现主机/客户端模式切换。
4. 实现图片墙静态展示。
5. 实现图片预览弹窗。
6. 实现前端筛选。
7. 实现前端打星状态变化。
8. 实现快捷键。
9. 实现设置页。
10. 实现导入进度 mock。
11. 实现客户端连接页 mock。
12. 实现归档流程 mock。

前端阶段不要接真实 API。

后端阶段在静态流程确认后进行：Electron 主进程、本地 Express、SQLite、配置文件、仓库检查、活动 API、图片导入、sharp 缩略图、图片查询、打星/状态/分类 API、Socket.IO、上传、下载、ZIP、已修图回传、归档、远程传输目录监听。

## 18. Codex 工作要求

- 分模块开发，不要一次性生成完整项目。
- 每次只处理一个模块。
- 每次完成后说明修改文件、如何运行、如何测试、未完成项。
- 每个任务开始前阅读本文档、当前项目结构、相关文件、Figma/MCP 页面设计。

禁止：

- 一次性重写整个项目。
- 未经要求引入云服务、Supabase、Vercel、MySQL、PostgreSQL。
- 把图片存入数据库。
- 删除或覆盖原图。
- 做真正分布式同步。
- 第一版实现 RAW 或强行实现 ngrok。
- 跳过 Figma 设计稿风格。
- 把启动页固定成某个品牌图标。
- 把界面做成移动端 App 风格。

## 19. 第一阶段任务拆分

1. 初始化 Electron + React + Vite + TypeScript + Tailwind 项目结构，只做前端静态。
2. 实现路由和布局：LaunchPage、HostDashboard、ClientConnectPage、EventsPage、ImportPage、GalleryPage、EditWorkflowPage、ExportPage、ArchivePage、SettingsPage。
3. 实现基础组件：AppLayout、Sidebar、Topbar、StatusBadge、RatingStars、ImageCard、ImageGrid、ImagePreviewModal、FilterSidebar、TaskProgress、NetworkStatusCard。
4. 创建 mock：events、images、users、tasks、archive records。
5. 实现图片墙交互：筛选、排序、选择、批量选择、预览、快捷键。
6. 实现主机/客户端模式前端。
7. 实现修图流转和导出归档静态流程。
8. 前端整体清理：统一样式、组件、空状态、错误状态、响应式布局。
