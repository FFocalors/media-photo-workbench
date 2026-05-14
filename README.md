# Media Photo Workbench / 融媒体图片工作台

## 项目简介

Media Photo Workbench 是面向校园融媒体中心、新闻中心及影像部门设计的 Windows 11 桌面端图片工作台系统。

系统核心定位为**局域网集中式协作管理平台**。本软件完全基于本地运行环境，采用 Electron 架构开发，将 Node.js (Express) 后端服务与 SQLite 数据库嵌入在 Electron 主进程中。不依赖任何外部云服务器。系统以一台运行本软件的主机为中心，集中保存源图片和数据库，支持多台客户端设备在局域网内协同进行上传、筛选、打星、修图状态流转及导出发布。

> **注意**：第一版仅支持 JPG/JPEG 格式，暂不支持 RAW 或视频格式。图片物理文件绝不存入 SQLite，数据库仅记录文件路径和生命周期状态。

## 核心功能

- **集中式存储**：一台主机管理本地数据库和真实图片文件。
- **局域网协同**：支持通过局域网连接主机，客户端可上传、下载或回传已修图。
- **工作流转**：覆盖照片导入、打星、分类、打回、待修图分配和最终发布的全生命周期。
- **批量处理**：支持快速导出成片包或待修包，一键活动归档。

## 当前开发状态

**当前版本：0.6.0-dev（修图流转阶段）**

项目已打通从主机建活动、本地导入、真实图片墙、单图下载、Socket.IO 实时同步、客户端上传协作，到待修包生成和已修图回传的核心闭环。当前仍处于开发阶段，尚未实现正式发布导出、活动归档和批量下载任务队列。

### 当前已实现功能
- Electron 桌面主进程与前端通信集成，实现原生弹窗（文件夹选择）与文件浏览器调用。
- Node.js (Express) 本地服务端在主进程生命周期内的安全挂载，并具备端口防冲突自愈机制。
- 统一前后端通信规范（严格的 `{ok, data, error}` 响应处理）。
- SQLite 数据库与 8 张核心结构表的初始化，启用 WAL 高性能模式。
- 基于本地真实数据库的活动 (Events) CRUD 管理。
- 创建新活动时，自动在宿主机本地进行物理工作区（Repository）的挂载及中文标准目录树构建。
- `config.json` 系统参数配置与 `pino` 日志系统接入。
- 主机本地 JPG/JPEG 导入，自动生成 WebP 缩略图和预览图，并读取 EXIF。
- 真实图片墙：缩略图、预览弹窗、打星、状态、分类、备注、文件存在状态和图片逻辑删除。
- 单图下载：原图、预览图，以及已修图下载预留接口。
- Socket.IO 实时同步：图片新增、更新和逻辑删除可在多窗口之间同步。
- 客户端模式：连接主机、读取活动、打开图片墙、下载图片、上传 JPG/JPEG 到主机。
- 修图流转：生成中文命名待修包 ZIP、`edit_manifest.json`、内置 manifest 的 `已修图回传` 文件夹、拖拽回传文件夹、manifest/文件名匹配、状态自动更新为已修图，重复回传只保留最新版本并刷新预览。

## 技术栈

- **构建工具**：Vite, pnpm
- **桌面端容器**：Electron
- **前端页面**：React 19, TypeScript, Tailwind CSS, Zustand, React Router
- **本地后端**：Node.js, Express, better-sqlite3, pino, fs-extra, sharp, exifr, Socket.IO

## 开发环境要求

为保证项目的可编译性和底层原生模块（如 `better-sqlite3`）的兼容性，请严格遵守以下开发环境要求：

- **操作系统**：Windows 11
- **Node.js**：v22.22.2 LTS (非常重要，请勿使用 v24 或不兼容版本，否则会导致 Electron ABI 编译失败)
- **包管理器**：pnpm
- **编辑器**：Visual Studio Code

## 安装依赖

由于包含需要编译的 C++ 原生模块，为解决国内下载 Github 包资源超时的问题，安装时建议指定镜像源：

```bash
pnpm install --registry=https://registry.npmmirror.com
```

## 启动开发环境

确保依赖安装成功后，依次执行以下命令即可一键拉起后端编译、Vite 前端和 Electron 容器：

```bash
# 1. 将后端的 TypeScript 代码编译为 CommonJS
pnpm build:server

# 2. 启动完整开发环境 (会自动运行前端和主进程)
pnpm dev
```

## 常用脚本

- `pnpm dev`：完整启动开发环境。
- `pnpm dev:electron`：启动底层服务与 Electron。
- `pnpm build:server`：编译后端 `src-server/` 代码至 `dist-server/`。
- `pnpm build`：打包前端与 Electron 用于生产发布。
- `pnpm rebuild:sqlite`：专门针对当前的 Electron 版本重编译 better-sqlite3 原生模块（如果出现 Node module version 报错时使用）。

## 项目目录结构

```text
MediaPhotoWorkbench/
├── config/             # 系统持久化配置文件目录
├── data/               # SQLite 数据库文件存放处 (被 gitignore 忽略)
├── dist/               # 前端 Vite 构建产物
├── dist-server/        # 后端 TypeScript 编译后的 JS 产物
├── electron/           # Electron 主进程 (main.cjs, preload.cjs)
├── logs/               # 系统运行日志目录
├── src/                # 前端 React 源代码
├── src-server/         # 后端 Express 及 SQLite 核心源代码
├── AGENTS.md           # 详细的产品开发要求与设计规范
├── API_SPEC.md         # 后端 API 接口设计文档
├── DATABASE_SCHEMA.md  # 数据库结构与枚举值参考文档
├── DEVELOPMENT_LOG.md  # 开发阶段记录日志
├── ROADMAP.md          # 阶段路线图
└── CHANGELOG.md        # 语义化版本变更日志
```

## 后续路线

详情请见 `CHANGELOG.md` 与 `AGENTS.md`。

下阶段重点：
- 发布导出：当前筛选、4 星以上、可发布、已修图。
- 发布规格：原尺寸、长边 3000px、长边 1920px。
- 批量下载 / ZIP 包任务队列。
- 活动归档。
