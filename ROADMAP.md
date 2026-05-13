# Media Photo Workbench / 融媒体图片工作台 - 路线图

## 当前阶段状态

项目已经从前端 Mock 阶段进入本地后端集成阶段。当前重点是保证主机端本地数据、仓库路径和活动工作目录稳定可靠，再进入图片导入。

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
- 新建活动会创建仓库工作目录。

### Phase 2 修复：仓库路径与活动工作区
- 仓库路径必须点击“保存”后才写入 `config/config.json`。
- 设置页重新进入时通过 `GET /api/settings` 读取真实已保存路径。
- 仓库检查只检查已保存路径，路径为空时明确提示。
- 新建活动默认 `active`。
- 新建活动前必须保证仓库路径存在、可读、可写。
- 新建活动成功前必须创建完整 `working/{event_slug}` 中文业务目录结构。

## 下一步

### Phase 3：图片导入基础
- 主机本地目录扫描。
- 第一版只识别 JPG/JPEG。
- 导入时只复制原图，不移动、不删除、不覆盖。
- 复制到 `working/{event_slug}/原图/主机导入`。
- 写入 `images` 表。
- 生成导入任务状态和失败记录。

### Phase 4：缩略图与预览图
- 引入 `sharp`。
- 生成 thumb：长边 400px，WebP。
- 生成 preview：长边 1600px，WebP。
- 图片墙改为读取真实 thumb。
- 预览弹窗改为读取真实 preview。

### Phase 5：真实图片墙与选片
- 图片查询 API。
- 星级、状态、分类、备注更新 API。
- 前端图片墙接入真实数据库。
- 操作日志落库。

### Phase 6：局域网协作
- Socket.IO 实时广播。
- 客户端上传 JPG。
- 多端状态同步。
- 下载单张原图、预览图、已修图。

### Phase 7：修图流转
- 待修包生成。
- `edit_manifest.json`。
- 已修图回传。
- manifest 优先匹配，文件名兜底匹配。

### Phase 8：导出与归档
- 发布导出规格：原尺寸、长边 3000px、长边 1920px。
- ZIP 生成。
- 活动归档、归档验证、工作区清理。
- 归档活动只读打开。

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
