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
- **0.12.0**：窗口适配、真实压力测试与问题修复
- **0.13.0**：Windows 打包发布
- **0.13.2**：Windows ZIP 便携预发布版与多设备测试
- **0.14.0**：故障排查、连接诊断与 NSIS 初步验证
- **0.15.0-rc.0**：导入性能与稳定性增强发布候选版
- **0.17.0**：现场协作与选片效率增强
- **1.1.0-alpha.1**：局域网相机 FTP 传输目录监听核心，合并到导入图片页面
- **1.1.0-alpha.3**：相机 FTP 全面迁移到 Windows IIS FTP + 当前接收活动自动导入
- **1.1.0-alpha.4**：IIS FTP UAC 执行器、结构化诊断、站点发现与前端状态机修复
- **1.1.0**：内部开发节点，不单独发布
- **1.2.0-alpha.1**：现场传图稳定性与使用体验重构
- **1.2.0 之后**：压力测试、多设备接入测试与后续功能规划

---

## [未发布] (Unreleased)

### feat/custom-window-shell - 自定义透明窗口外壳与只读顶部状态栏

- Electron 窗口改为 `transparent: true` + `titleBarStyle: 'hidden'` + `titleBarOverlay` 组合，实现自定义透明大圆角窗口并保留原生最小化/最大化/关闭按钮。
- 默认菜单栏（文件/编辑/视图/窗口/帮助）已隐藏；开发环境仍可通过 F12 / Ctrl+Shift+I 打开 DevTools。
- 新增 `WindowShell` 组件统一管理窗口圆角、阴影和最大化状态切换：窗口化时显示 24px 圆角和柔和阴影，最大化时铺满屏幕、圆角和阴影归零。
- 新增只读 `AppTitleBar`（48px 高度），显示应用图标、应用名称、运行模式、当前活动名称、已导入数量和已修数量；所有业务内容不可点击，空白区域支持窗口拖动。
- 新增 `currentPageEventStore` 轻量 Zustand Store，各页面选择活动后同步更新标题栏上下文；使用 owner token 防止异步页面切换竞态。
- 新增 `windowStateStore` 管理窗口最大化/全屏状态，通过 Electron IPC 实时同步。
- 新增 `GET /api/events/:id/summary` 轻量活动摘要接口，返回 `total_images`（排除逻辑删除）和 `edited_images`（`edited_path != ''`），纯 SQL COUNT，无文件系统访问。
- 标题栏通过 Socket.IO 事件（image-created / image-updated / image-deleted-logical）节流刷新统计，不使用定时轮询。
- 左侧栏（主机和客户端）改为独立圆角矩形容器，四边留有间距，最大化后仍保留圆角和间距。
- 启动页使用同一窗口外壳但只显示应用图标和名称，不显示业务状态。
- 已接入 Overview、PhotoWall、Import、Retouch、Export、Archive 和客户端页面的活动上下文同步。
- 透明窗口方案依赖 Windows 11 DWM 圆角和 Electron 33.4.11 透明能力；已在代码中预留降级模式记录点。
- 已知风险：透明窗口在多显示器不同 DPI、Snap Layout 和非 Windows 11 环境下可能存在兼容差异，需后续实际环境验证。
- HostLayout.tsx 的底部管理员/TaskCenter 区域保持原样，与 feature/connected-clients-panel 并行分支的手动合并待后续进行。

### v1.2.0-alpha.1 - 现场传图稳定性与使用体验重构

- 从 `v1.1.0-alpha.4` 直接进入 `v1.2.0-alpha.1`；`v1.1.0` 仅作为内部开发节点，不创建 Tag、Release 或发布包。
- 项目版本、设置页“关于”信息和核心文档统一到 `1.2.0-alpha.1`。
- 建立重构前基线：记录 `pnpm build`、`pnpm test:camera-ftp` 和 `git diff --check` 结果及普通权限 IIS 检测限制。
- 本版本按六阶段渐进实施：开发基线、状态真相与启动恢复、稳定性故障注入、前后端模块化、状态/提示/错误统一、重启恢复与数据安全。
- 配置增加 `schemaVersion = 1` 与幂等迁移；旧 FTP 明文密码递归清理，损坏 JSON、旧/当前 schema 字段类型错误、未来版本和写入失败均保留原配置并 fail closed，不再回退为空配置继续启动。
- SQLite 增加 `schema_migrations` 成功账本并复核账本/schema 漂移；高风险 `images` 表重建前以 `VACUUM INTO` 创建并校验备份，失败备份受控保留 3 份，失败不发布连接。相机 FTP 回执随活动生命周期保留，只在永久删除活动时显式清理并由外键级联兜底。
- `server.log` 增加启动前大小轮转与受控保留；当前写入日志不会被删除。API、orchestrator、provisioning、PowerShell、verify/rollback、日志和前端错误增加父子 `operationId` 关联。
- 新增主机只读 `/api/camera-ftp/diagnostics` 与设置页白名单诊断，排除密码、SecureString、复合 token/credential 字段、账户详情、图片/FTP 完整路径、最近文件名、提权临时输入和其他 IIS 站点配置；错误卡分别显示父子 operationId，成功轮询不覆盖最近业务操作。
- 活动永久删除改为“不可变 purge journal → 同父目录原子隔离 → 数据库事务 → 提交后文件删除”；数据库失败恢复原目录，提交后清理失败返回明确部分成功，进程重启后按 SQLite 提交真相自动恢复或继续清理。
- 新增配置、数据库、活动永久删除、日志和诊断/operationId 五组阶段六自动回归；删除安全增加提交前/提交后进程边界恢复，前端增加 HTTP/envelope 冲突、无效 envelope、中性权限提示、不可重试按钮和提权日志复合敏感键回归，并继续覆盖重启补扫、历史回执、数据库失败、旁路故障和 partial/failed rollback。
- 本轮不执行压力测试或多设备接入测试，只准备下一阶段人工清单；不新增相机来源识别、现场接收看板、一键现场模式、公网远传、FTPS/SFTP、RAW/视频、相机 SDK、云同步、AI 选片、多 FTP 账户、完整权限系统或安装器重做。
- 本轮不打 Tag、不创建 Release、不打包 ZIP、不生成安装包、不提交、不推送。

### v1.1.0-alpha.4 - IIS FTP 首次配置与 UAC 诊断闭环

- 新增统一 IIS FTP Provisioning：普通权限只读 Preflight 与结构化 Plan，setup/repair/start/restart/adopt-site 共用一个管理员事务完成 Apply、Verify 和 Commit/Rollback；start 检测到缺项时自动 repair 后启动。
- 修复 IIS / Windows PowerShell 5.1 把 `ftpServer.state` 返回数值 `1` 时，工作台把实际 Started 的站点误判为超时失败并回滚的问题；同时兼容 `0/1/2/3/4` 与状态名称。
- 托管站点改为 `managedSiteId` 优先定位；授权修复只替换目标账户规则，保留无关用户规则；计划和管理员预检不创建目录，解除活动关联不再使用 last-known 状态绕过实时安全检查。
- Windows Feature 要求重启时返回 `WINDOWS_RESTART_REQUIRED` 并在后续系统修改前安全暂停；FTPSVC 原启动类型/运行状态纳入安全回滚，失败响应保留 preflight、plan、completedSteps 和逐项 rollback。
- 前端新增六种计划状态、七阶段执行提示和信息/自动修复/用户确认/阻塞四级问题中心；ACL 收紧、服务器级 PASV 和站点接管均在执行前显示资源边界与风险。
- 修复受保护且非规范顺序的 FTP 接收目录 ACL 无法再次修改的问题：写入前按 Windows 规则重建 canonical DACL，写入后验证目标账户实际读写权限；修改前保存 SDDL，回滚后精确比对安全描述符。
- 修复 ACL 回滚只记录调用成功却未确认恢复结果的问题；回滚现在逐项验证，失败时返回 partial/failed 并保留托管账户以避免新增孤立 SID，错误详情包含 failedStep、HRESULT 和 ACL 诊断。
- 修复 repair 遇到账户缺失时没有携带密码、导致安全重试再次失败的问题；页面会要求填写一次性密码，成功后才清空。
- 配置计划和检测提示改为关键项优先、长列表折叠；首次配置主操作提前。所有通用确认弹窗限制 viewport 高度，固定标题与底部按钮，中间内容独立滚动并避免横向溢出。
- 管理员操作成功响应直接保留本轮完整检测；之后的普通轮询保持 partial 标识，但不再用 unknown 覆盖刚确认的管理员字段。
- FTP 控制端口由固定 21 改为 `1-65535` 可配置，默认仍推荐 21；IIS binding、防火墙、状态检测、启动验证和 Nikon 参数统一使用已保存的实际端口。
- 新增控制端口/被动端口即时校验、Windows 保留端口检测、PID/进程与 IIS 站点归属、工作台托管归属和候选空闲端口。候选端口必须由用户确认，不自动切换。
- 修复 TCP 未监听且普通权限无法读取 IIS binding 时仍显示“可用”的问题；现在显示“需管理员确认”，显式检测会请求只读 UAC，以识别已绑定但未启动的 IIS FTP 站点。
- 修复自定义端口 setup 在读取 IIS 全局 PASV 配置时访问不存在的全局 `externalIp4Address` 属性、触发 `0x80070585 无效索引` 并回滚的问题。
- 修复 22 等自定义端口通过冲突预检后，setup 将 FTP `authorization` 误当成站点内嵌 `ftpServer/security` 子元素、导致“无法识别的元素 authorization”并回滚的问题；授权规则现在通过站点作用域 `system.ftpServer/security/authorization` 配置节读写，首次配置、接管、账户更新和回滚使用同一实现。
- 修复旧版 FTP 防火墙规则更新时同时使用 `Set-NetFirewallRule -Name` 与 `-DisplayName`、导致互斥参数集失败的问题；改用 `-NewDisplayName` 并保留底层命令和系统错误。
- 修复 FTPSVC 已运行时仍在“启动 Microsoft FTP Service”阶段失败的问题：IIS FTP 站点运行状态、自动启动和启停现在使用站点级 `ftpServer.state / serverAutoStart / Start / Stop`，不再误用面向 Web 站点的通用 `Site.State / Site.Start / Site.Stop`。
- 服务启动、FTP 站点启动和控制端口监听验证拆分为独立阶段与错误码；失败详情包含 FTPSVC 状态、FTP 站点前后状态、底层异常、HRESULT 和回滚提示，不再统一建议用户检查 Windows 服务。
- 旧版 GUID 内部名称的本地防火墙规则需要改变时，首次管理员预检返回端口/作用域差异，前端弹出第二次高风险确认后才允许更新；组策略、动态、来源不明或重名规则不会被强制修改。
- 防火墙规则更新新增完整快照回滚：本次更新失败或后续 IIS/服务验证失败时恢复原显示名、启用状态、端口和地址范围；新建的工作台专用规则仍在失败时删除。
- setup/repair/adopt 的端口冲突预检提前到系统修改之前；不停止其他程序、不修改无关 IIS 站点、不删除其他 binding、不静默接管。修复完成后执行管理员权限完整复检，关键项全部通过才返回成功。
- 高级设置允许修改 IIS 服务器级被动端口范围并明确提示全局影响；控制端口不得落入被动端口范围。
- 修复 OneDrive Files On-Demand 目录带有 `ReparsePoint` 属性时被误判为符号链接，导致 setup 在 `validate_configuration` 阶段返回 `FTP_PATH_INVALID` 的问题；仅真正的 SymbolicLink / Junction 继续被拒绝。
- 修复 Windows PowerShell 5.1 将无 BOM UTF-8 临时脚本按 ANSI 解析、导致脚本在结果 JSON 写入前退出且页面只看到退出码 1 的问题；生成的 UAC launcher / runner 统一写入 UTF-8 BOM。
- 提权执行器改为每次操作独立 UUID 目录，分别保存输入、状态和结果文件；记录 UAC 请求、进程启动、完成、退出码、失败阶段、回滚状态和耗时，所有路径均支持中文、空格和单引号。
- PowerShell 结果统一返回 `operation/stage/code/message/technicalMessage/exceptionType/command/siteName/rollbackAttempted/rollbackSucceeded/timestamp/data/warnings`，并按输入、权限、功能、站点、账户、ACL、防火墙、服务和回滚使用不同退出码。
- setup、adopt、credentials、control 和 status 脚本补齐阶段标记、结构化异常与失败回滚结果；PASV 保持 `50000-50100`，防火墙保持 `Profile Any + RemoteAddress LocalSubnet`，并兼容接管旧版同用途防火墙规则。
- 新增只读提权站点发现接口。普通权限无法读取 IIS 站点详情时，用户可点击管理员检测，通过 UAC 获取可接管站点列表，再明确选择并确认；不静默修改或覆盖端口 21 的现有站点。
- 前端按 `initialized/passwordConfigured/site.started` 计算按钮状态：未初始化时只开放“配置并启动 FTP”和站点检测；未设置密码时禁止启动/重启；失败后保留密码表单并支持原操作重试，成功后才清空密码。
- `UAC_CANCELLED` 独立显示为未执行修改；其他错误显示中文失败阶段、处理建议、脱敏技术详情、复制详情、打开日志和重试入口，不再直接展示原始英文 PowerShell 文本。
- 新增 Windows PowerShell 5.1 协议、提权 IPC、UI 状态机与脱敏测试；自动测试不调用真实 setup/adopt/start/stop/repair，不修改 IIS、账户、ACL、防火墙或现有测试目录。
- 本轮不打 tag、不创建 Release、不打包 ZIP、不自动提交。

### v1.1.0-alpha.3 - 相机 FTP 迁移到 Windows IIS FTP

- 进入 `v1.1.0-alpha.3` 架构重构阶段，本轮不打 tag、不创建 Release、不打包 ZIP、不自动提交。
- 相机 FTP 入口继续保留在“导入图片 > 相机 FTP”tab，不恢复独立侧边栏入口或独立页面。
- 正式架构只保留 Windows IIS FTP 单一 provider；旧 Node.js `ftp-srv` 内置 Server、协议兼容层、FTP session、原始命令诊断和 `2121` 建议全部废弃，不保留 fallback。
- 工作台新增 IIS 状态检测、初始化、接管、启动、停止、重启和修复能力，统一检查 Windows 功能、`ftpsvc`、IIS 站点、身份验证、授权、ACL、端口和防火墙。
- IIS 站点绑定全部适用本地接口，控制端口固定为 `21`，被动端口固定为 `50000-50100`；防火墙按 `LocalSubnet` 配置，不把 `192.168.137.1` 或 WLAN 地址写死进 binding。
- 相机 FTP 同时支持“相机与主机连接同一 Wi-Fi”和“相机连接 Windows 移动热点”两种局域网模式；页面分别展示 WLAN 与热点地址，校园网存在客户端隔离时优先建议热点模式。
- 新配置使用 `provider: "iis"` 和独立的 `activeEventId`；同一时间只有一个 FTP 接收活动，IIS 物理路径、watcher 和原图最终目录统一指向 `working/{event_slug}/原图/相机FTP/`。
- 活动切换前检查未稳定文件和正在处理的 watcher 任务；存在上传或导入时阻止切换，成功后再保存 `activeEventId`，失败时回滚 IIS 物理路径、站点状态和 watcher。
- Windows 普通启动不要求管理员权限；启用 Windows 功能、修改 IIS / 防火墙 / 本地账户 / ACL 或系统服务时才通过 UAC 和短生命周期 JSON 文件执行提权 PowerShell。
- FTP 用户名默认 `camera`，全局共用一套账户；首次配置通过“选择活动 → 填写账户 → 配置并启动 FTP”一次闭环完成，普通权限部分检测不会锁死输入和 UAC 操作。
- “导入图片 > 相机 FTP”tab 重构为 IIS 总状态、环境检查、服务操作、当前接收活动、账户设置、双网络模式、Nikon 参数、最近接收和站点冲突接管模块。
- 最近接收数据来自当前活动 `原图/相机FTP` 目录 watcher；相机原图稳定后原地入库，不再复制或重命名到第二个原图目录。
- 继续复用文件大小与 mtime 稳定检测以及现有图片导入管线：JPG / JPEG 稳定后以 `sourceType = camera_ftp` 导入，保留同活动 hash 去重、缩略图 / 预览图、EXIF、SQLite、`image-created` 和 `camera_ftp_import` 任务。
- `/api/camera-ftp/*` 命名空间保持不变，当前提供结构化 `status/setup/adopt-site/start/stop/restart/repair/credentials/active-event/open-folder` 接口。
- “停止 FTP”与“解除活动关联”已拆分；停止站点保留 `activeEventId`、目录和 watcher，解除关联必须在站点停止且无上传任务时单独确认。旧 `ftp/`、`camera_ftp_upload` 和已有 IIS 测试目录不会自动删除。
- 多台相机可共用同一账户，页面提示为不同相机配置不同文件名前缀，避免同名覆盖。
- 本阶段不实现公网 FTP、FTPS / SFTP、相机 SDK、RAW / HEIC / 视频、远程传输或远程图片墙。

### v1.1.0-alpha.1 - 相机 FTP 传输目录监听

- 本节仅记录 alpha.1 历史实现；其中外部 FTP Server 和 `camera_ftp_upload` 目录方案已被 alpha.3 的 Windows IIS FTP 单 provider 架构取代，不再作为当前配置方式。
- 进入 `v1.1.0-alpha.1` 开发阶段，本轮不打 tag、不创建 Release、不打包 ZIP。
- 主机端将相机 FTP 作为“导入图片”页面内的来源 tab，不再作为独立一级侧边栏入口；支持绑定当前 active / reviewing 活动、选择或创建 `working/{event_slug}/camera_ftp_upload` 接收目录。
- 相机 FTP tab 补充普通用户配置说明：同一 Wi-Fi、Windows 热点、外部 FTP Server 映射目录、相机服务器地址 / 端口 / 用户名 / 密码 / 上传目录 / 传输模式填写建议。
- 新增目录监听服务：监听外部 FTP Server 映射目录中的 JPG / JPEG / PNG，忽略临时文件和非图片文件。
- 新增文件稳定检测：按文件大小和 mtime 连续稳定后再导入，避免处理 FTP 上传中的半文件；读取失败会有限重试，单文件失败不影响 watcher。
- 相机 FTP 自动导入复用现有导入管线：sha256 去重、同活动去重、原图复制、缩略图 / 预览图生成、SQLite 写入、`image-created` 广播。
- 新增任务类型 `camera_ftp_import`，任务中心显示“相机 FTP 导入”的 total、processed、success、skipped、failed、currentFileName 和 errors。
- 图片来源新增 `camera_ftp`，上传角色记录为 `camera`，图片元数据、预览弹窗、筛选器、首页最近动态均显示“相机 FTP”来源。
- 新增 `/api/camera-ftp/*` 配置、默认目录、启动、停止、状态和最近记录 API。
- 数据库不新增表或字段；仅扩展 `images.source` CHECK 允许 `camera_ftp`，旧库启动时执行兼容迁移。
- 本阶段不包含内置 FTP Server、公网 FTP、FTPS / SFTP、相机品牌 SDK、RAW / HEIC / 视频、断点续传、云中继、远程图片墙或远程协作管理。

### v1.1.0 内部开发阶段（发布计划已取消）

- 暂缓 v1.0.0 正式发布并进入 v1.1.0 内部开发阶段；该节点最终未发布，由 `v1.2.0-alpha.1` 直接接续。
- 当时记录的 `MediaPhotoWorkbench-v1.1.0-x64.zip` 发布计划已取消，没有生成对应正式发布包。
- 主机 / 客户端局域网协作流程继续作为核心能力：主机集中管理活动、仓库、数据库、任务和导出归档，客户端负责连接主机、上传图片、查看图片墙、下载待修包和回传已修图。
- JPG / JPEG / PNG 导入和上传作为 1.0 核心支持格式；RAW / HEIC / 视频暂不支持。
- 主机支持选择文件夹导入、选择图片文件导入，以及拖拽图片 / 文件夹导入；文件夹导入当前只扫描第一层。
- 客户端支持单张 / 多张上传和拖拽上传图片；客户端拖拽文件夹上传暂不支持。
- 图片墙支持分页、缩略图、预览弹窗、星级、状态、分类、备注、状态筛选、星级等于 / 及以上筛选、上传来源筛选和搜索。
- 图片墙支持批量状态、批量星级、批量分类，以及批量操作后清空 / 保留选择配置。
- 任务中心统一展示导入、客户端上传处理、批量 ZIP 下载、发布导出、待修包生成、已修图回传、活动归档和归档清理任务。
- 修图协作支持待修包生成、平均拆包、自定义分包、待修包下载、误生成待修包删除和已修图回传。
- 导出发布支持发布图导出和批量 ZIP 下载。
- 活动归档支持轻量归档、只读历史、归档清理、活动回收站和图片回收站。
- 数据库维护支持手动备份、启动自动备份和数据库位置迁移；旧数据库和用户图片仓库不会被自动删除。
- 协作追踪支持在线客户端、设备名、上传来源、上传者、上传时间、操作归属和主机最近动态。
- 故障排查支持打开日志目录和复制诊断信息，覆盖局域网地址、防火墙、校园网隔离和 Windows 热点场景。
- 已知限制：NSIS 暂不推荐，Web Installer 不提供，RAW / HEIC / 视频暂不支持，远程传输和云同步暂不支持，账号权限系统暂不纳入 1.0。

### v0.17.0 开发阶段：17.2 图片墙效率增强

- 图片墙顶部和预览弹窗新增快捷键提示入口，覆盖 1-5、0、X、E、P、左右方向键和 Esc，说明与现有预览快捷键一致。
- 图片墙“更多操作”新增批量分类，可将同一分类写入所选图片，也可留空清空分类；沿用现有操作日志操作者记录。
- 设置页新增“批量操作后清空选择 / 保留选择”偏好，默认清空；批量状态、批量分类、删除、恢复和永久删除部分失败时，清空模式保留失败项，便于重试。
- 根据现场使用反馈，移除筛选预设和快捷筛选入口，图片墙保留状态、星级、上传来源 / 上传者和搜索等基础筛选。
- 17.2 不涉及账号系统、登录、权限、远程传输、RAW / HEIC / 视频、NSIS、发布策略、Git tag、Release 或自动提交。

### v0.17.0 开发阶段：17.1 现场协作感知与来源追踪

- 主机端新增在线客户端感知，客户端连接后通过 Socket.IO 上报持久化 `clientId` 和设备名称，主机首页与图片墙可查看在线客户端数量，首页显示在线客户端列表。
- 客户端连接页增加“设备名称”输入框，默认自动生成并保存到 localStorage，刷新后保持同一个 `clientId` / `clientName`。
- 客户端上传 JPG/JPEG/PNG 时写入 `uploaded_by_client_id`、`uploaded_by_name`、`uploaded_by_role`、`uploaded_at`，主机本地导入显示为主机导入。
- 图片元数据和预览详情显示来源、上传者和上传时间；旧数据缺少上传者时按 `source` 显示主机导入、客户端上传或未知来源。
- 图片墙筛选区新增“上传来源 / 上传者”筛选，支持全部来源、主机导入、全部客户端上传和具体客户端设备，并与星级、状态、搜索等现有筛选组合。
- 星级、状态、分类、备注、逻辑删除和恢复操作写入 `operation_logs.actor_type / actor_id / actor_name`，旧日志字段为空时仍兼容。
- 主机首页新增现场动态卡片，内存保留最近 20 条上传、图片修改、删除 / 恢复和任务完成动态。
- 新增 `GET /api/clients/online`、`GET /api/events/:eventId/uploaders` 和 `clients-updated` Socket.IO 事件；17.1 不涉及账号系统、登录、权限系统、云同步或远程传输。

### v0.16.0 开发阶段：16.5 数据库备份与数据库位置迁移

- 设置页“数据库位置”区域接入真实维护能力，支持手动立即备份数据库。
- 数据库备份保存到当前图片仓库的 `metadata/database-backups/`，手动备份命名为 `app-manual-YYYYMMDD-HHmmss.db`。
- 启动自动备份默认启用：仓库路径已配置且可写时，每 24 小时最多生成一次 `app-auto-YYYYMMDD-HHmmss.db`，并仅清理超出保留数量的自动备份，不删除手动备份。
- 数据库路径配置扩展为独立的 `config.database.path`，启动时优先使用该路径；未配置时开发模式使用项目 `data/app.db`，打包模式使用可写的 userData `data/app.db`。
- 新增数据库位置迁移能力：迁移前先备份当前数据库，使用 SQLite backup 生成目标 `app.db`，验证通过后写入配置并提示重启生效。
- 迁移失败时不会修改配置，若中途失败会回滚配置并清理临时文件；旧数据库始终保留，不会删除用户图片仓库。
- `/api/settings` 和 `/api/health` 补充数据库路径与备份配置状态；`API_SPEC.md` 记录数据库备份、备份列表和迁移接口。

### v0.16.0 开发阶段：16.4 拖拽导入 / 拖拽上传体验增强

- 主机导入页新增拖拽入口，支持将 JPG/JPEG/PNG 图片文件直接拖入导入区域，并复用现有 `filePaths` 导入任务。
- 主机导入页支持拖拽文件夹作为导入来源，继续沿用文件夹第一层非递归扫描规则，不支持 RAW、HEIC、视频或 WebP 原图。
- 客户端上传页新增拖拽上传入口，支持拖入单张或多张 JPG/JPEG/PNG 图片；客户端拖拽文件夹会显示明确提示，暂不作为上传来源。
- Electron preload 新增安全路径读取能力，主进程新增拖拽路径检查 IPC，只读取文件 / 文件夹元信息，不暴露任意文件写入能力。
- 拖拽入口不绕过现有导入、上传、去重和任务中心流程；任务中心继续显示导入或客户端上传后端处理进度。

### v0.16.0 开发阶段：16.3 任务中心覆盖补齐

- 梳理并统一耗时操作的任务中心覆盖范围，确认主机导入、客户端上传处理、批量 ZIP 下载、待修包生成、发布导出、活动归档 prepare、归档 cleanup 已接入统一任务系统。
- 已修图回传改为后台 `edited_upload` 任务，主机端和客户端回传页面会监听对应 `task-updated`，显示总数、已处理、匹配成功、未匹配、错误摘要、当前文件和预计剩余时间。
- 任务中心补充 `edited_upload` 类型识别和中文任务名，取消入口覆盖导入、客户端上传处理和已修图回传等可安全停止的处理类任务。
- 统一任务中心任务名称、进度、成功 / 失败 / 跳过统计、错误列表和下载入口展示；批量 ZIP、发布导出、待修包等完成后继续在任务结果中保留下载或输出路径信息。
- API 文档补充任务系统通用字段、任务类型和已修图回传任务化返回格式。

### v0.16.0 开发阶段：16.2 任务中心一致性与导入结果面板修复

- 修复主机导入页右侧“处理结果”不随后台导入任务更新的问题；`import/start` 返回 `taskId` 后，导入页会监听对应 `task-updated` 并同步显示总数、已处理、成功、失败、跳过、进度和错误摘要。
- 新增前端任务统计归一化工具，任务中心、主机导入页和客户端上传页统一读取 `total / finished / successCount / failedCount / skippedCount / result`，避免同一任务在不同页面显示不同数值。
- 客户端多图上传页同步监听后端处理任务，上传后可在页面侧栏看到处理进度和最终成功 / 跳过 / 失败数量。
- 待修包生成、发布导出和归档 prepare 的轻量任务记录补充最终图片级统计与错误摘要，任务中心完成态不再只显示 1/1 的粗略任务数。

### v0.16.0 开发阶段：16.1 实战问题修复

- 修复客户端实时接收新图后缩略图 / 预览图偶发加载失败、需要刷新或重启才能显示的问题：图片资源加载增加有限自动重试，实时插入和更新的图片 URL 增加缓存键。
- 优化 `image-created` 实时接收后的前端合并逻辑，避免同一图片重复插入，并保持主机端与客户端图片墙实时同步。
- 修复批量状态修改只更新第一张或部分图片的问题：批量状态操作改为基于选中 ID 快照执行 `Promise.allSettled`，单张失败不阻断其他图片，并在完成后显示成功 / 失败数量。
- 优化筛选条件下的预览体验：打开预览时冻结当前预览列表 snapshot，预览中修改状态不会立即关闭弹窗或打断左右切换；关闭预览后图片墙再按当前筛选条件刷新。
- 星级筛选新增精确匹配能力，`GET /api/events/:eventId/images` 支持 `ratingMode=eq | gte`，默认仍为旧版 `gte` 行为。

## [0.15.0-rc.0] - 2026-05-20

- 项目版本号同步为 `0.15.0-rc.0`，进入 Windows ZIP 便携发布候选整理阶段。
- 归档清理工作区改为后台 `archive_cleanup` 任务，接口快速返回 `taskId`，任务中心显示删除进度、已用时间和预计剩余时间，修复多图活动清理 `working` 目录时页面长时间卡住的问题。
- 归档清理改为逐文件 / 逐目录删除并带重试；如果资源管理器、图片查看器或 OneDrive 占用活动目录，会返回明确错误提示而不是一直无反馈。
- 继续优化大批量导入：主机导入和客户端上传处理改为后台任务，`import/start` 与 `upload` 返回 `taskId`，任务中心通过 `task-updated` 实时显示导入进度。
- 导入任务新增已处理 / 总数、成功、跳过、失败、已用时间、预计剩余时间和当前文件名展示，并支持在任务中心取消导入；取消后已成功导入图片保留，未处理图片停止导入。
- 图片导入管线改为有限并发处理，预编译常用数据库语句，同一批次内提前去重，并限制任务错误列表数量，降低 4000 张级别导入时的长请求阻塞和日志压力。
- 修复关闭程序时导入任务仍在写入 `pino` 日志可能触发 `thread-stream` worker exited 主进程错误的问题：后端关闭时会请求取消运行任务，日志写入改为安全封装，Electron 主进程补充关闭阶段异常兜底记录。
- 新增 PNG 图片支持：主机本地导入、客户端上传、WebP 缩略图/预览图、图片墙展示、原图下载、批量 ZIP 和待修包均兼容 PNG 原图。
- 主机导入页新增“选择图片文件”模式，支持从文件夹中手动多选 JPG/JPEG/PNG，只导入所选文件；原“选择文件夹”模式继续保留第一层非递归扫描。
- 发布导出保持 JPG 发布图策略：PNG 原图不会被改写，原图下载和待修包保留 PNG，发布导出时由 `sharp` 转为 JPEG，透明 PNG 使用白底合成；已修图回传仍限定 JPG/JPEG 成片。
- 修复图片墙只显示 200 张且无法查看剩余图片的问题，大图量活动可继续加载 / 翻页查看，底部数量显示与实际总数一致。
- 当前交付策略保持 Windows ZIP 便携包优先，推荐发布产物为 `MediaPhotoWorkbench-v0.15.0-rc.0-x64.zip`。
- NSIS 安装包仍标记为“暂不推荐 / 后续再评估”，单文件 portable EXE 暂不作为推荐交付物。

## [0.14.0] - 2026-05-20

- 完成 NSIS 安装包初步验证：生成安装包后人工测试发现安装进度卡住、取消按钮无响应，需要通过任务管理器或 PowerShell 强制结束安装器。
- NSIS 安装包当前标记为“暂不推荐 / 后续再评估”，不作为发布候选阻塞项，也不作为推荐交付物。
- 当前交付策略保持 Windows ZIP 便携包优先。
- 连接失败体验优化：客户端连接页按地址格式错误、网络无响应 / 防火墙 / 校园网隔离、目标端口无服务和 API `ok=false` 返回分类显示排查建议。
- 主机首页局域网访问地址区域补充推荐连接顺序：优先使用 WLAN / 以太网地址，校园网不通时使用 Windows 热点，仍无法连接时复制诊断信息排查。
- README 新增“客户端无法连接怎么办”章节，补充真实地址端口、同网段、校园网设备隔离、Windows 热点、防火墙和诊断信息收集说明。
- 新增“故障排查 / 诊断信息”入口：系统设置页可打开日志目录，并复制包含版本、运行模式、真实端口、API、数据库、仓库、剩余空间、局域网地址、热点候选地址和当前活动摘要的诊断文本。
- Electron preload 运行时信息补充 `appVersion`、`appDataRoot` 和 `logsDir`，前端复用现有 `shell:open-path` 能力打开日志目录。
- v0.13.2-dev Windows ZIP 便携预发布版已发布到 GitHub Release：`https://github.com/FFocalors/media-photo-workbench/releases/tag/v0.13.2-dev`。
- v0.13.2-dev 本机测试、多设备测试、压力测试和主机 Windows 热点连接测试均已通过。
- 当前推荐交付物为 `MediaPhotoWorkbench-v0.13.2-dev-x64.zip`，使用方式为解压 ZIP 后双击 `Media Photo Workbench.exe`。
- 客户端可通过主机首页复制局域网访问地址，或扫描主机首页二维码访问主机页面；校园网可能存在设备隔离，同 Wi-Fi 无法互访时推荐使用主机 Windows 热点。
- 当前导入与客户端上传支持 JPG/JPEG/PNG，RAW / HEIC / 视频仍不在当前发布范围内；已修图回传仍使用 JPG/JPEG 成片。
- 新增 `TESTING_NOTES.md`，记录 v0.13.2-dev 发布后测试状态、已知限制和 v0.14.0 线下补测清单。
- v0.13.0-dev 发布前轻量 UI 优化：主机首页和客户端连接页二维码改为连接式圆滑二维码，不再只是外层卡片圆角，也不再是分离点阵；客户端连接页根据输入的主机地址生成真实二维码。
- 启动页标题调整为中文优先、英文弱化显示；Electron 窗口标题和页面标题同步为“融媒体图片工作台 · Media Photo Workbench”。
- 新增品牌 Logo 组件和资源路径：前端 Logo 使用 `src/assets/brand/app-icon.png`，Electron 窗口图标优先读取 `build/icon.png`；`electron-builder` 已配置 `build/icon.ico` 作为 Windows 图标，并将 `build/icon.png` / `build/icon.ico` 作为额外资源候选。
- 生产模式下 Express 托管前端 `dist/`，非 `/api`、非 `/socket.io` 的 GET/HEAD 请求回退到 `index.html`，保证 React Router 页面刷新不 404。
- 打包后前端页面、后端 API 和 Socket.IO 复用同一后端端口；局域网客户端访问 `http://主机IP:{serverPort}`，不再依赖 Vite `5173`。
- Electron 生产模式改为加载 `http://127.0.0.1:{serverPort}`，开发模式继续加载 Vite `http://127.0.0.1:5173`。
- 前端 API 基址支持生产同源访问；浏览器打开后端托管页面时默认使用当前 origin 访问 `/api`，避免局域网客户端错误请求自己的 `localhost:3030`。
- 新增 `dist:portable` 和 `dist:win` 脚本，并配置 electron-builder 生成 Windows 便携 ZIP 包和 NSIS 安装包到 `release-pack/`；单文件 self-extract portable EXE 暂不作为当前主交付物。
- ZIP 便携包作为当前主交付形式；单文件 self-extract portable EXE 暂不作为当前主交付物。
- NSIS 安装包后续进入 v0.14.0 初步验证；当前验证结论为安装器卡住，暂不推荐作为交付物。
- electron-builder 配置加入 `asarUnpack`，为 `better-sqlite3`、`sharp`、`@img`、`@emnapi` 等原生依赖预留打包运行支持。
- 主机首页根据开发/生产访问模式区分地址展示：开发模式显示前端 `5173` 候选和后端 API 地址；生产模式显示客户端访问地址和 API 健康检查地址。
- 主机首页 / 系统概览页新增真实磁盘剩余空间显示：`GET /api/repository/check` 和 `GET /api/health` 返回 `freeSpaceBytes`、`totalSpaceBytes`、`usedSpaceBytes` 及可读文本，前端展示容量比例环形图；仓库路径未配置、路径不存在或读取失败时显示明确状态，不影响 `/api/health` 整体可用。
- 主机首页新增真实二维码生成：开发模式下二维码指向 `http://主机IP:5173`，生产模式下指向 `http://主机IP:{serverPort}`；回环地址和虚拟机网卡不生成二维码；无可用局域网地址时占位提示而不生成假二维码；二维码在 Electron 和浏览器中均可正常显示，生成失败不影响首页其他状态展示。
- v0.12.0-dev 窗口适配、真实压力测试与问题修复。
- Electron 主窗口最小尺寸调整为 `1200 x 760`，同时补充页面级响应式策略，避免只依赖窗口下限。
- 图片墙顶部工具栏精简为搜索、筛选结果、实时同步状态、视图切换和筛选/元数据入口；选择当前、清除选择、图片回收站、删除所选、下载所选 ZIP、导出当前筛选和批量状态操作统一收进“更多操作”菜单。
- 图片墙筛选栏在中窄窗口下改为抽屉式打开，元数据栏在非宽屏下默认隐藏并通过“元数据”按钮打开，图片墙区域优先保留可用宽度。
- 图片缩略图网格改为自适应列宽，降低非最大化窗口下固定列数造成的挤压。
- 主机待修图自定义分包、已修图回传、客户端上传、客户端修图任务、导出发布、归档管理和主机首页补充中等宽度布局适配。
- 文档明确第一版重点保证 Windows 桌面端非最大化窗口可用，手机和平板仅作为轻量访问入口，不做完整移动端工作流适配。
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
- 校园网环境可能存在设备隔离；同 Wi-Fi 无法访问主机时，推荐使用主机 Windows 热点作为现场连接方案。
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
- 新增 `POST /api/events/:eventId/import/scan`，支持非递归扫描本地图片文件夹；当前已扩展为 JPG/JPEG/PNG。
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
- v0.14.0：故障排查、连接诊断与 NSIS 初步验证，重点包括防火墙 / 热点 / 校园网连接排查提示、错误日志导出入口、一键打开日志目录和 README 故障排查章节完善；NSIS 安装包移入后续待评估项。
- 待 v1.2.0 六阶段稳定性重构及后续压力/多设备测试完成后，再评估远程传输预留或远程连接。

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
