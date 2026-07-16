# Media Photo Workbench / 融媒体图片工作台 - 数据库结构

## 数据库设计原则

- **当前版本**：`v1.2.0-alpha.1`。
- **当前状态**：相机 FTP 继续使用 Windows IIS FTP 单一架构；页面入口仍在“导入图片 > 相机 FTP”。现有 schema 已包含 `camera_ftp_file_receipts`；v1.2.0 第三阶段为同名覆盖识别兼容增加 `content_hash`，第六阶段新增显式迁移账本与高风险迁移备份，不改变现有业务枚举含义。所有后续迁移必须幂等、可诊断、失败关闭。
- **技术选型**：使用 SQLite 关系型数据库。
- **文件位置**：数据库文件默认位于软件目录 `data/app.db`。
- **分离存储**：真正的图片文件（如原始 JPG、WebP 缩略图）**绝不**存入数据库，数据库只存储元数据、文件路径、状态和操作日志。
  - 原图路径（`original_path`）、缩略图路径（`thumb_path`）、预览图路径（`preview_path`）必须分别存储。
- **高并发配置**：必须开启 Write-Ahead Logging 模式，所有连接都需要执行 `PRAGMA journal_mode = WAL`。
- **访问限制**：客户端（如局域网内的其他笔记本、平板）**不能**直接访问 SQLite 文件，所有读写操作必须经过主机 Node.js 后端 API 进行安全分发。
- **归档策略**：活动结束后要进行归档，主库不能无限增长。
  - 归档活动将生成独立的 `event.db` 并跟随归档目录存放。
  - 主数据库清理完毕后，只在 `archived_events` 表中保留该活动的只读摘要索引。

## 迁移与更新策略

- 当前启动迁移由 `src-server/db/database.ts` 的有序迁移注册表管理，并在 `schema_migrations` 中记录成功版本；迁移 ID 不得复用或改写。后续如拆出 SQL 文件，仍必须通过同一账本按顺序执行。
- **绝对不允许**在生产环境中直接手动修改 SQLite 数据库的表结构。
- v0.17.0 开发阶段 17.1 允许轻量兼容迁移：启动时通过 `PRAGMA table_info` 检查字段，缺失时才为 `images` 增加上传来源追踪字段、为 `operation_logs` 增加 actor 字段；字段已存在则跳过，不要求重新初始化旧库。
- v0.17.0 开发阶段 17.2 不新增 SQLite 字段或表。批量操作后选择行为保存在本地 `config.json` 的 `gallery` 配置中。
- v1.1.0-alpha.1 为支持 `source = camera_ftp` 扩展 `images.source` CHECK 枚举；v1.1.0-alpha.4 新增轻量 `camera_ftp_file_receipts` 表，持久化已处理 FTP 文件的路径、大小、修改时间和结果，避免工作台重启后重复导入。两项均由启动时 schema/migration 自动完成，不要求重新初始化数据库。
- v1.1.0-alpha.3 当时不新增 SQLite 表、字段、索引或迁移逻辑；现行本地 `config/config.json` 只保存 IIS 站点、非敏感账户状态、`activeEventId`、可配置控制端口、被动端口范围和防火墙规则名。控制端口默认 `21`，允许 `1-65535` 且不得落入被动端口范围。旧明文 FTP 密码会被清理，不迁移到 IIS 配置。
- v1.2.0-alpha.1 第六阶段将现有兼容步骤登记为四项幂等迁移。轻量变更在事务内执行；`images` CHECK 表重建前使用 `VACUUM INTO` 写入 `.migration-backups/` 唯一备份并执行 `quick_check`，失败重试最多保留 3 份已验证备份。只有迁移事务提交后才写账本；启动还会复核已登记迁移对应的表/列/索引，账本与实际 schema 漂移或迁移失败时关闭连接、清空运行时数据库状态，不以“数据库正常”继续启动。

---

## 配置文件扩展：`config.json`

17.2 新增图片墙偏好配置，v1.1.0-alpha.1 新增相机 FTP 配置，v1.1.0-alpha.3 迁移为 IIS FTP 非敏感参数；这些都不属于 SQLite schema：

```json
{
  "schemaVersion": 1,
  "gallery": {
    "batchSelectionBehavior": "clear"
  },
  "cameraFtp": {
    "provider": "iis",
    "siteName": "MediaPhotoWorkbenchFTP",
    "managedSiteId": 0,
    "username": "camera",
    "accountManaged": false,
    "activeEventId": "",
    "controlPort": 21,
    "passivePortStart": 50000,
    "passivePortEnd": 50100,
    "firewallControlRuleName": "Media Photo Workbench - FTP Control",
    "firewallPassiveRuleName": "Media Photo Workbench - FTP Passive",
    "passwordResetRequired": false
  }
}
```

`schemaVersion` 当前为 `1`。加载时迁移必须幂等，并在归一化前递归清理旧 FTP 明文密码字段；损坏 JSON、旧/当前 schema 已知字段类型错误、非法/未来版本或迁移写入失败会停止启动并保留原文件。保存先写同目录临时文件再原子替换，失败时磁盘与内存中的旧有效配置不变。`batchSelectionBehavior` 支持 `clear | keep`，默认 `clear`。`cameraFtp` 不保存密码；`passwordResetRequired` 仅表示旧配置已清除明文密码、需要用户重新设置。`managedSiteId` 在成功创建或显式接管站点后保存真实 IIS Site ID，`0` 表示尚未建立可信站点绑定。密码不写入 SQLite、`operation_logs`、迁移备份或配置文件。

---

## 核心数据表

### 0. `schema_migrations`（Schema 迁移账本）
**用途**：只记录已经成功提交的数据库迁移，保证应用重启和重复打开时幂等。

| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | TEXT | 不可复用的迁移 ID | PRIMARY KEY |
| `applied_at` | TEXT | 成功提交时间 | NOT NULL, DEFAULT `now` |
| `backup_path` | TEXT | 高风险迁移前受控备份路径；轻量迁移为空 | NOT NULL, DEFAULT '' |

当前登记项为 legacy columns、`images.source` camera_ftp CHECK、receipt `content_hash` 和当前索引。账本不记录失败迁移；备份只包含 SQLite 数据，不包含 FTP 密码。

### 1. `events` (活动表)
**用途**：记录所有的拍摄活动。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | TEXT | 活动唯一ID | PRIMARY KEY |
| `name` | TEXT | 活动名称 | NOT NULL |
| `slug` | TEXT | URL友好标识（拼音/英文） | NOT NULL, UNIQUE |
| `date` | TEXT | 活动日期 (YYYY-MM-DD) | NOT NULL |
| `location` | TEXT | 拍摄地点 | NOT NULL, DEFAULT '' |
| `status` | TEXT | 活动状态 | NOT NULL, DEFAULT 'active', 取值见枚举 |
| `total_images` | INTEGER | 图片总数统计 | NOT NULL, DEFAULT 0 |
| `selected_images`| INTEGER | 选入修图或发布的数量 | NOT NULL, DEFAULT 0 |
| `created_at` | TEXT | 创建时间 | NOT NULL, DEFAULT `now` |
| `updated_at` | TEXT | 更新时间 | NOT NULL, DEFAULT `now` |

### 2. `images` (图片表)
**用途**：记录导入的每一张图片及其生命周期状态。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | TEXT | 图片唯一ID | PRIMARY KEY |
| `event_id` | TEXT | 所属活动ID | NOT NULL, FOREIGN KEY -> events(id) ON DELETE CASCADE |
| `original_filename` | TEXT | 原文件名 | NOT NULL |
| `stored_filename` | TEXT | 物理存储防重名 | NOT NULL |
| `thumb_path` | TEXT | 缩略图路径 (长边400px WebP) | NOT NULL, DEFAULT '' |
| `preview_path` | TEXT | 预览图路径 (长边1600px WebP)| NOT NULL, DEFAULT '' |
| `original_path` | TEXT | 原图路径 (JPG) | NOT NULL, DEFAULT '' |
| `edited_path` | TEXT | 已修图回传路径 (JPG) | NOT NULL, DEFAULT '' |
| `photographer`| TEXT | 摄影师姓名 | NOT NULL, DEFAULT '' |
| `camera_model`| TEXT | 相机型号 (EXIF) | NOT NULL, DEFAULT '' |
| `lens_model` | TEXT | 镜头型号 (EXIF) | NOT NULL, DEFAULT '' |
| `shot_at` | TEXT | 拍摄时间 (格式化后) | NOT NULL, DEFAULT '' |
| `rating` | INTEGER | 星级打分 (0-5) | NOT NULL, DEFAULT 0 |
| `status` | TEXT | 状态流转 | NOT NULL, DEFAULT 'unselected', 取值见枚举 |
| `category` | TEXT | 主分类 | NOT NULL, DEFAULT '' |
| `remark` | TEXT | 修图备注/意见 | NOT NULL, DEFAULT '' |
| `source` | TEXT | 导入来源 | NOT NULL, DEFAULT 'host_import', 取值见枚举 |
| `uploaded_by_client_id` | TEXT | 上传客户端 ID；主机导入可为 `host`，旧数据可为空 | NOT NULL, DEFAULT '' |
| `uploaded_by_name` | TEXT | 上传设备名称或来源名称，如“修图电脑A” | NOT NULL, DEFAULT '' |
| `uploaded_by_role` | TEXT | 轻量来源角色，如 `client` / `host` / `camera`，不是账号权限 | NOT NULL, DEFAULT '' |
| `uploaded_at` | TEXT | 上传 / 导入入库时间 | NOT NULL, DEFAULT '' |
| `file_size` | INTEGER | 文件大小 (Bytes) | NOT NULL, DEFAULT 0 |
| `file_hash` | TEXT | 防重 hash (可选) | NOT NULL, DEFAULT '' |
| `exif_shot_at`| TEXT | 原始 EXIF 拍摄时间字符串 | NOT NULL, DEFAULT '' |
| `width` | INTEGER | 图片像素宽 | NOT NULL, DEFAULT 0 |
| `height` | INTEGER | 图片像素高 | NOT NULL, DEFAULT 0 |
| `is_deleted` | INTEGER | 图片逻辑删除标记，1 表示已从图片墙移除 | NOT NULL, DEFAULT 0 |
| `deleted_at` | TEXT | 图片逻辑删除时间 | NOT NULL, DEFAULT '' |
| `created_at` | TEXT | 入库时间 | NOT NULL, DEFAULT `now` |
| `updated_at` | TEXT | 更新时间 | NOT NULL, DEFAULT `now` |

### 3. `tags` (标签表)
**用途**：存储系统全局或活动通用的多维度标签。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | TEXT | 标签唯一ID | PRIMARY KEY |
| `name` | TEXT | 标签名称 | NOT NULL, UNIQUE |
| `color` | TEXT | 标签展示颜色 | NOT NULL, DEFAULT '' |
| `created_at`| TEXT | 创建时间 | NOT NULL, DEFAULT `now` |

### 4. `image_tags` (图片标签关联表)
**用途**：多对多关系表，记录某图片打上了哪些标签。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `image_id` | TEXT | 图片ID | NOT NULL, FOREIGN KEY -> images(id) ON DELETE CASCADE |
| `tag_id` | TEXT | 标签ID | NOT NULL, FOREIGN KEY -> tags(id) ON DELETE CASCADE |
*(约束：(image_id, tag_id) 联合主键)*

### 5. `operation_logs` (操作日志表)
**用途**：记录所有核心的人为与系统操作，用于审计与行为追溯。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | INTEGER| 自增主键 | PRIMARY KEY AUTOINCREMENT |
| `type` | TEXT | 操作类型 (如 rating_changed) | NOT NULL |
| `target_type`| TEXT | 操作对象 (如 image/event) | NOT NULL, DEFAULT '' |
| `target_id` | TEXT | 操作对象ID | NOT NULL, DEFAULT '' |
| `operator` | TEXT | 操作人姓名 | NOT NULL, DEFAULT '' |
| `device` | TEXT | 客户端设备名 | NOT NULL, DEFAULT '' |
| `actor_type` | TEXT | 操作者类型：`host` / `client` / `camera` / `unknown` | NOT NULL, DEFAULT '' |
| `actor_id` | TEXT | 操作者 ID；客户端为 `clientId`，主机为 `host` | NOT NULL, DEFAULT '' |
| `actor_name` | TEXT | 操作者显示名，如“主机”或客户端设备名 | NOT NULL, DEFAULT '' |
| `detail` | TEXT | JSON格式的变更详情 | NOT NULL, DEFAULT '' |
| `created_at`| TEXT | 记录时间 | NOT NULL, DEFAULT `now` |

### 6. `download_logs` (下载日志表)
**用途**：分离于普通操作，专门记录物理文件的提取和下载行为。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | INTEGER| 自增主键 | PRIMARY KEY AUTOINCREMENT |
| `image_id` | TEXT | 单张图片ID (如有) | NOT NULL, DEFAULT '' |
| `event_id` | TEXT | 涉及的活动ID | NOT NULL, DEFAULT '' |
| `type` | TEXT | 下载物料类型 | NOT NULL, DEFAULT 'original', 取值见枚举 |
| `operator` | TEXT | 下载人姓名 | NOT NULL, DEFAULT '' |
| `device` | TEXT | 下载设备名 | NOT NULL, DEFAULT '' |
| `file_path` | TEXT | 生成的供下载的物理路径 | NOT NULL, DEFAULT '' |
| `created_at`| TEXT | 记录时间 | NOT NULL, DEFAULT `now` |

### 6.1 `camera_ftp_file_receipts`（相机 FTP 文件处理回执）
**用途**：记录已经成功导入或确认重复跳过的相机 FTP 文件指纹。watcher 重启时以路径、大小、修改时间和内容 SHA-256 共同确认未变化历史文件；发生变化、同名覆盖或停机期间新上传的文件仍会进入稳定检测。

| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `event_id` | TEXT | 所属活动 ID | NOT NULL, FOREIGN KEY -> events(id) ON DELETE CASCADE |
| `path_key` | TEXT | Windows 规范化小写路径键 | NOT NULL |
| `file_path` | TEXT | 文件绝对路径 | NOT NULL |
| `file_size` | INTEGER | 完成处理时文件大小 | NOT NULL, DEFAULT 0 |
| `modified_ms` | INTEGER | 完成处理时文件修改时间戳 | NOT NULL, DEFAULT 0 |
| `content_hash` | TEXT | 文件内容 SHA-256；用于识别同路径、同大小/mtime 的相机覆盖 | NOT NULL, DEFAULT '' |
| `result` | TEXT | `imported` 或 `skipped` | NOT NULL |
| `updated_at` | TEXT | 最近处理时间 | NOT NULL, DEFAULT `now` |

联合主键为 `(event_id, path_key)`。表中不保存 FTP 密码、图片内容或 EXIF；`content_hash` 仅保存不可逆的内容指纹。旧回执在恢复时可从对应 `images.file_hash` 安全补齐，仍为空时 watcher 会分批计算实际文件 hash 后再决定是否跳过。回执不按时间删除：活动存在、逻辑删除或按现有策略归档时继续保留；活动永久删除时在同一事务显式清理，并由 `ON DELETE CASCADE` 兜底，避免历史文件因回执过早消失而被重新导入。

### 7. `export_jobs` (导出任务表)
**用途**：记录正式发布、待修包、批量打包等后台长耗时任务或生成物状态信息。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | TEXT | 任务ID | PRIMARY KEY |
| `event_id` | TEXT | 关联活动ID | NOT NULL, DEFAULT '' |
| `type` | TEXT | 任务类型 | NOT NULL, DEFAULT '' |
| `status` | TEXT | 任务执行状态 | NOT NULL, DEFAULT 'pending', 取值见枚举 |
| `spec` | TEXT | 导出规格 (如 3000px, quality 90)| NOT NULL, DEFAULT '' |
| `quality` | INTEGER| 导出画质 (0-100) | NOT NULL, DEFAULT 90 |
| `total` | INTEGER| 预计处理总数 | NOT NULL, DEFAULT 0 |
| `finished` | INTEGER| 已处理数 | NOT NULL, DEFAULT 0 |
| `success_count`| INTEGER| 成功数 | NOT NULL, DEFAULT 0 |
| `failed_count` | INTEGER| 失败数 | NOT NULL, DEFAULT 0 |
| `output_path`| TEXT | 最终产物存放的物理目录/文件 | NOT NULL, DEFAULT '' |
| `operator` | TEXT | 触发人 | NOT NULL, DEFAULT '' |
| `created_at`| TEXT | 任务创建时间 | NOT NULL, DEFAULT `now` |
| `updated_at`| TEXT | 最后更新时间 | NOT NULL, DEFAULT `now` |

当前已使用的 `type`：
- `edit_package`：Phase 6 / v0.11.5 待修包 ZIP 记录，`output_path` 指向 ZIP 文件；单包、平均拆包和自定义分包信息写入 `spec` JSON，例如 `package_name`、`package_index`、`package_total`、`manifest_count`。

### 8. `archived_events` (归档活动摘要表)
**用途**：当原活动归档并清出主库后，在此留下不可修改的摘要索引，供主页展示历史。
| 字段名 | 类型 | 含义 | 约束 |
|---|---|---|---|
| `id` | TEXT | 摘要记录ID | PRIMARY KEY |
| `event_id` | TEXT | 原活动ID | NOT NULL |
| `event_name` | TEXT | 原活动名称 | NOT NULL |
| `event_slug` | TEXT | 原活动Slug | NOT NULL |
| `event_date` | TEXT | 原活动日期 | NOT NULL |
| `total_images`| INTEGER| 历史图片总数 | NOT NULL, DEFAULT 0 |
| `edited_images`| INTEGER| 历史完修数量 | NOT NULL, DEFAULT 0 |
| `published_images`|INTEGER| 历史发布数量 | NOT NULL, DEFAULT 0 |
| `archive_path`| TEXT | 归档包存放的绝对物理路径 | NOT NULL, DEFAULT '' |
| `archived_at` | TEXT | 执行归档的时间 | NOT NULL, DEFAULT `now` |

> v0.11.1-dev 轻量归档不新增数据库字段。详情接口以 `archived_events.archive_path` 为入口，读取 `缩略图/`、`metadata/manifest.json`、`images.csv`、`operation_logs.csv` 和 `event.db` 文件状态；只读展示不修改 `events` 或 `images`。删除归档时会删除对应 `archive_path` 和 `archived_events` 摘要。活动回收站永久删除会额外清理该活动的图片记录、图片标签关联、下载日志、导出任务、操作日志和归档摘要。

---

## 核心枚举值参考

## 索引与去重

- `idx_images_event_id`：按活动查询图片。
- `idx_images_status`：按图片状态筛选。
- `idx_images_rating`：按星级筛选。
- `idx_images_file_hash`：Phase 3 主机本地导入按 sha256 `file_hash` 去重；去重范围为同一活动，发现当前 `event_id` 下已有相同 hash 时跳过导入。
- `idx_images_event_hash`：按 `event_id + file_hash` 加速同一活动内去重查询。
- `idx_images_deleted`：默认图片墙查询过滤 `is_deleted = 0`。
- `idx_images_uploaded_by_client`：按活动和上传客户端筛选图片。
- `idx_operation_logs_actor`：按操作者类型和 ID 查询操作日志。
- `idx_camera_ftp_receipts_event`：按活动恢复相机 FTP 已处理文件指纹。

### `events.status`
- `draft`：草稿/未开始（保留状态，当前新建活动不默认使用）
- `active`：进行中（新建活动默认状态，可导入、上传）
- `reviewing`：选片修图流转中
- `archived`：已归档完毕（主库中可能已清理至 archived_events）
- `deleted`：逻辑删除

> 当前实现约束：创建活动前必须已经保存可读写的仓库路径。后端会先创建 `working/{event_slug}` 中文业务目录结构，再向 `events` 表写入活动记录，避免出现没有物理工作区的活动。

### `images.source_type` (对应 `images.source`)
- `host_import`：主机端直接扫描本地文件夹导入
- `client_upload`：客户端通过局域网网页/软件主动上传
- `camera_ftp`：相机通过 Windows IIS FTP 直接上传到当前活动 `working/{event_slug}/原图/相机FTP/`；稳定后原地写入图片记录，`original_path` 指向该文件，不复制第二份原图
- `remote_import`：远程传输预留来源值，当前版本仍未实现远程传输
- `manual_import`：其他零星手动导入方式

### 17.1 协作追踪字段说明

- `images.uploaded_by_*` 只记录协作来源，不代表账号、登录用户或权限主体。
- 客户端上传时，前端随 multipart 请求提交 `clientId` 和 `clientName`；当前无账号系统，后端先作为现场协作标识记录。
- 主机导入时，来源显示为“主机导入 / 主机”。历史旧数据字段为空时，前端按 `images.source` 兜底显示。
- `operation_logs.actor_*` 用于标记谁修改了星级、状态、分类、备注、删除或恢复。旧日志 actor 字段为空时应显示“未知操作者”或继续读取旧 `operator/device`。

### `images.status`
- `unselected`：未挑选（新导入默认初态）
- `rejected`：废片（按 X 键抛弃）
- `archive`：暂存留底（不送修也不作废）
- `edit`：待修图（筛选后进入修片池）
- `edited`：已修图（修片师回传对应文件后）
- `publish`：可发布（直出标记可发 或 修片验收通过）
- `published`：已实际导出或打包发布过（标记记录用）

> 图片删除不复用 `images.status`，而是通过 `is_deleted/deleted_at` 表达生命周期。图片墙删除为逻辑删除，只隐藏记录，不删除原图、缩略图、预览图或已修图文件；图片回收站可恢复，也可在二次确认后永久删除图片记录及其关联文件。

> 活动删除通过 `events.status = deleted` 表达。活动回收站可恢复活动；永久删除仅允许对 `deleted` 活动执行。working/archive 目标必须严格位于仓库受控根目录且不得相互嵌套。首次移动前先在仓库 `.mpw-purge-journal/` 原子写入不含密码的不可变恢复日志，再于同一父目录原子隔离；数据库记录在单一事务中清理，失败时恢复隔离目录。数据库提交后才删除隔离目录；若此步失败则返回部分成功和保留路径。进程重启时以 SQLite 中活动记录是否仍存在为真相，分别恢复隔离目录或继续清理，不伪报文件已清理。

### `download_logs.download_type` (对应 `download_logs.type`)
- `original`：获取单张或多张原图
- `preview`：获取大尺寸预览图
- `edited`：获取修片师提交的成片
- `zip`：将选定内容打包下载压缩合集
- `export`：发布时的统一标准图包

### `export_jobs.status`
- `pending`：排队中未开始
- `running`：正在处理/压缩图片
- `success`：全部处理成功
- `failed`：中途报错中止或发生致命失败
- `cancelled`：用户主动手动取消任务

## 任务系统说明

v0.10.0-dev 第一版任务系统使用内存任务管理器，不新增 `tasks` 表。任务字段包括 `id`、`type`、`eventId`、`title`、`status`、`total`、`finished`、`successCount`、`failedCount`、`skippedCount`、`errors`、`result`、`createdAt`、`updatedAt`、`finishedAt`。

当前任务数据用于运行期进度展示和 Socket.IO `task-updated` 实时推送；应用重启后任务列表会清空。后续如需要跨重启追踪、重试或审计，再新增持久化任务表。
