# Media Photo Workbench / 融媒体图片工作台 - API 规范

## 当前阶段说明

当前阶段为 **v1.2.0-alpha.1** 现场传图稳定性与使用体验重构阶段。`v1.1.0` 仅作为内部开发节点，不单独发布；项目从 `v1.1.0-alpha.4` 直接进入本版本线。v1.0.0-rc.1 已作为预发布验证版本发布；当前局域网相机 FTP 继续使用“Windows IIS FTP + 当前 FTP 活动 watcher + 自动导入”单一架构。

本阶段延续生产模式访问方式：打包后 Express 托管前端 `dist/`，前端页面、`/api` 接口和 Socket.IO 复用同一个后端端口。开发模式仍使用 Vite `5173` 访问前端、`3030-3040` 访问后端 API。本轮不打包、不打 Tag、不创建 GitHub Release，不改变现有 API 路径和核心业务语义。

前端入口仍位于“导入图片 > 相机 FTP”tab，`/api/camera-ftp/*` 命名空间保持不变。IIS binding 为 `*:{controlPort}:`，控制端口默认 `21` 且可配置，PASV 默认 `50000-50100`，当前 FTP 活动根目录为 `working/{event_slug}/原图/相机FTP/`。该目录同时是 IIS 上传目录、相机原图最终目录、watcher 目录和 `images.original_path` 所在目录；稳定后原地导入，不复制第二份原图。

接收目录允许位于 OneDrive Files On-Demand 仓库。Windows 为云占位目录设置的 `ReparsePoint` 属性本身不代表路径重定向；只有带 `LinkType/Target` 的真实 SymbolicLink 或 Junction 会以 `FTP_PATH_INVALID` 拒绝。

IIS 内部实现中，站点 binding、Authentication、SSL 和站点级 firewallSupport 从 `system.applicationHost/sites` 的 FTP 站点元素读取；FTP Authorization Rules 则通过站点作用域的 `system.ftpServer/security/authorization` 配置节读取和提交。setup、adopt-site、credentials、status 和失败回滚必须使用同一站点作用域，避免自定义控制端口已通过预检后在授权阶段失败。该修正不改变 `/api/camera-ftp/*` 请求或响应结构。

FTP 站点运行时与通用 Web 站点运行时分开：状态读取 `ftpServer.state`，自动启动写入 `ftpServer.serverAutoStart`，启停调用 `ftpServer.Start/Stop`；共享 Windows 服务只通过 `FTPSVC` 管理。管理员操作使用 `start_ftp_service / start_ftp_site / verify_ftp_listener` 独立阶段，避免 FTPSVC 已运行时把目标 FTP 站点启动失败误报为服务故障。

Microsoft.Web.Administration 在 Windows PowerShell 5.1 下可能把 FTP SSL、Authorization accessType 和 permissions flags 返回为数值字符串。服务层按本机 IIS schema 将 `0 -> SslAllow`、`0 -> Allow`、`3 -> Read, Write` 归一化，并在结构化诊断中保留 raw 值。最终验证逐项返回 `id / code / passed / expected / actual`；失败详情同时包含 `failedChecks / failedCodes / verificationChecks`。

## 统一规范

所有 API 前缀统一为 `/api`。

### 开发与生产访问方式

开发模式：

```text
前端页面：http://主机局域网IP:5173
后端 API：http://主机局域网IP:{serverPort}/api/health
Socket.IO：http://主机局域网IP:{serverPort}
```

生产 / 打包模式：

```text
前端页面：http://主机局域网IP:{serverPort}
后端 API：http://主机局域网IP:{serverPort}/api/health
Socket.IO：http://主机局域网IP:{serverPort}
```

其中 `{serverPort}` 由后端 `3030-3040` 自动端口机制决定。生产模式下非 `/api`、非 `/socket.io` 的前端路由请求会回退到 `index.html`，用于支持 React Router 刷新。

校园网环境可能存在设备隔离；如果同 Wi-Fi 下客户端无法访问主机，推荐使用主机 Windows 热点，其他设备连接热点后再访问主机首页显示的真实地址。

### 统一响应格式

**成功：**
```json
{
  "ok": true,
  "data": {},
  "error": null,
  "operationId": "本次请求的操作 ID"
}
```

**失败：**
```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "title": "面向用户的中文标题",
    "message": "错误说明",
    "impact": "本次失败对现有状态的影响",
    "nextAction": "用户下一步可以执行的动作",
    "rollbackStatus": "not_required | success | partial | failed | unknown",
    "operationId": "可用于串联日志和诊断的操作 ID",
    "retryable": true,
    "technicalDetails": "可选、已脱敏的技术摘要",
    "details": {}
  }
}
```

`operationId` 是 additive 可选字段；每个 API 请求还会返回 `X-Operation-Id` 响应头。客户端可发送格式安全的同名请求头用于关联，否则后端生成 UUID。`code / message / details` 为原有兼容字段；v1.2.0-alpha.1 新增的展示字段不改变现有 HTTP 路径或旧客户端解析方式。`technicalDetails` 可省略，前端默认折叠，并可分别显示 API 父请求与提权 `childOperationId`；不得包含 FTP 密码、SecureString、token、credential、提权输入文件内容或完整本地路径。若声明为 JSON 的响应损坏，前端返回 `HTTP_INVALID_JSON_RESPONSE` 并保留 `X-Operation-Id`，不得把解析异常伪装为业务成功。

---

## 一、Health 健康检查

### [已实现] 获取系统健康状态
- **用途**：检查后端服务、数据库、仓库路径和配置的健康状态。
- **请求方法**：`GET`
- **路径**：`/api/health`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "service": "media-photo-workbench",
      "server": { "port": 3031, "configuredPort": 3030, "status": "running" },
      "database": {
        "status": "connected",
        "path": "D:\\project\\Image Workspace\\data\\app.db"
      },
      "repository": {
        "configured": true,
        "exists": true,
        "readable": true,
        "writable": true,
        "freeSpace": 137438953472,
        "totalSpace": 1099511627776,
        "freeSpaceBytes": 137438953472,
        "totalSpaceBytes": 1099511627776,
        "usedSpaceBytes": 962072674304,
        "freeSpaceText": "128.0 GB",
        "totalSpaceText": "1.0 TB",
        "capacityError": "",
        "path": "D:\\photos"
      },
      "config": {
        "loaded": true,
        "server": { "port": 3030 },
        "repository": { "path": "D:\\photos" }
      },
      "network": {
        "localhost": "127.0.0.1",
        "lanAddresses": [
          { "name": "Wi-Fi", "address": "192.168.1.23", "family": "IPv4", "internal": false }
        ],
        "hotspotAddress": "192.168.137.1"
      }
    },
    "error": null
  }
  ```
- **备注**：前端启动、客户端连接、主机系统概览页和相机 FTP 地址提示会调用该接口。`server.port` 是本次真实监听端口，`server.configuredPort` 是配置中的首选端口。`network.lanAddresses` 来自当前主机 Wi-Fi / WLAN / 以太网 IPv4 网卡，已过滤 VMware、Docker、WSL、Hyper-V 等虚拟网卡；`network.hotspotAddress` 是 Windows 热点地址或候选地址，`192.168.137.1` 只是常见候选值，不是唯一固定值。容量读取失败时 `freeSpace` / `totalSpace` 可能为 `null`，前端应显示“暂不可用”而不是假容量。

---

## 一点五、Clients 在线客户端

### [已实现] 获取在线客户端列表
- **用途**：主机端显示当前在线客户端数量和设备列表。主机自身不计入在线客户端。
- **请求方法**：`GET`
- **路径**：`/api/clients/online`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "clients": [
        {
          "clientId": "7f0f0a52-1111-4a2a-8888-123456789abc",
          "clientName": "修图电脑A",
          "role": "client",
          "connectedAt": "2026-05-22T08:20:00.000Z",
          "lastSeenAt": "2026-05-22T08:21:00.000Z",
          "userAgent": "Mozilla/5.0 ...",
          "address": "::ffff:192.168.1.24"
        }
      ]
    },
    "error": null
  }
  ```
- **备注**：在线列表仅在服务端内存维护，客户端断开后会更新；不做账号、登录或权限系统。

---

## 二、Settings 设置

`/api/settings/*` 与 `/api/repository/*` 包含本机数据库、仓库和 IIS 元数据，只允许主机本机调用；局域网客户端不得读取或修改这些路径。

### [已实现] 获取当前设置
- **用途**：获取系统的全量配置信息。
- **请求方法**：`GET`
- **路径**：`/api/settings`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "server": { "port": 3030 },
      "repository": { "path": "D:\\photos" },
      "database": {
        "path": "D:\\project\\Image Workspace\\data\\app.db",
        "configuredPath": "",
        "defaultPath": "D:\\project\\Image Workspace\\data\\app.db",
        "autoBackupEnabled": true,
        "lastAutoBackupAt": "2026-05-21T08:00:00.000Z",
        "autoBackupRetention": 10
      },
      "gallery": {
        "batchSelectionBehavior": "clear"
      },
      "cameraFtp": {
        "provider": "iis",
        "siteName": "MediaPhotoWorkbenchFTP",
        "managedSiteId": 0,
        "username": "camera",
        "accountManaged": false,
        "activeEventId": "evt_xxx",
        "controlPort": 21,
        "passivePortStart": 50000,
        "passivePortEnd": 50100,
        "firewallControlRuleName": "Media Photo Workbench - FTP Control",
        "firewallPassiveRuleName": "Media Photo Workbench - FTP Passive",
        "passwordResetRequired": false
      }
    },
    "error": null
  }
  ```
- **备注**：`database.path` 是当前进程实际使用的数据库路径；`configuredPath` 是配置文件中的自定义数据库路径，未设置时为空；`defaultPath` 是未配置自定义路径时的默认位置。`gallery.batchSelectionBehavior` 取值为 `clear | keep`。开发模式默认使用项目 `data/app.db`，打包模式默认使用 Electron userData 下的 `data/app.db`。

- **v1.1.0-alpha.3 补充**：`cameraFtp` 只保存非敏感的 IIS 管理元数据和 `activeEventId`。FTP 密码不写入配置、SQLite、API 响应或日志；旧配置中的明文密码在加载迁移时被清理并转为 `passwordResetRequired` 状态。
- `managedSiteId` 是工作台成功创建或显式接管后保存的 IIS Site ID。后续系统修改必须同时匹配站点名、Site ID、至少一个 FTP binding 和托管账户标记；`0` 表示尚未建立可信绑定，不能据同名站点推断所有权。授权规则属于可修复配置：缺失或错误时 `site.managed=false`，但在上述所有权证据完整时允许“一键修复”恢复授权。

### [已实现] 更新图片墙偏好设置
- **用途**：设置批量操作后保留或清空选择。
- **请求方法**：`PATCH`
- **路径**：`/api/settings/gallery`
- **请求体示例**：
  ```json
  {
    "batchSelectionBehavior": "clear"
  }
  ```
- **响应示例**：返回更新后的 `gallery` 配置。
- **备注**：`batchSelectionBehavior=clear` 为默认值；批量操作部分失败时前端保留失败项以便重试。`keep` 表示批量操作后保留原选择。

### [已实现] 检查仓库路径
- **用途**：验证当前已保存仓库路径的可行性（是否存在、可读写）。
- **请求方法**：`GET`
- **路径**：`/api/repository/check`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "exists": true,
      "readable": true,
      "writable": true,
      "freeSpace": 137438953472,
      "totalSpace": 1099511627776,
      "freeSpaceBytes": 137438953472,
      "totalSpaceBytes": 1099511627776,
      "usedSpaceBytes": 962072674304,
      "freeSpaceText": "128.0 GB",
      "totalSpaceText": "1.0 TB",
      "capacityError": "",
      "path": "D:\\photos"
    },
    "error": null
  }
  ```
- **备注**：当前实现检查 `config/config.json` 中已保存的 `repository.path`，并尝试读取仓库所在磁盘容量。容量读取失败不会导致接口整体失败，相关字段会返回 `null` 并通过 `capacityError` 说明原因。

### [已实现] 更新仓库路径
- **用途**：修改系统使用的全局图片仓库路径。
- **请求方法**：`PATCH`
- **路径**：`/api/settings/repository`
- **请求参数示例**：
  ```json
  {
    "path": "D:\\new_photos_folder"
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "saved": true,
      "exists": true,
      "readable": true,
      "writable": true,
      "freeSpace": 137438953472,
      "totalSpace": 1099511627776,
      "freeSpaceBytes": 137438953472,
      "totalSpaceBytes": 1099511627776,
      "usedSpaceBytes": 962072674304,
      "freeSpaceText": "128.0 GB",
      "totalSpaceText": "1.0 TB",
      "capacityError": "",
      "path": "D:\\new_photos_folder"
    },
    "error": null
  }
  ```
- **错误码**：
  - `INVALID_PATH`：`path` 不是字符串或为空字符串。
  - `SAVE_CONFIG_FAILED`：配置文件写入失败。
- **备注**：该接口会保存 trim 后的路径并返回检查结果，但不会自动创建仓库根目录。

### [已实现] 立即备份数据库
- **用途**：将当前 SQLite 数据库备份到当前图片仓库的 `metadata/database-backups/`。
- **请求方法**：`POST`
- **路径**：`/api/settings/database/backup`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "backupPath": "E:\\MediaPhotoWorkspace\\metadata\\database-backups\\app-manual-20260521-143012.db",
      "size": 1234567,
      "createdAt": "2026-05-21T14:30:12.000Z",
      "method": "sqlite-backup"
    },
    "error": null
  }
  ```
- **错误码**：
  - `REPOSITORY_NOT_CONFIGURED`：尚未配置图片仓库路径。
  - `REPOSITORY_NOT_WRITABLE`：仓库不可写或路径不可用。
  - `DATABASE_BACKUP_FAILED`：SQLite 备份失败。
- **备注**：备份前会对 WAL 执行 checkpoint，并使用 SQLite / better-sqlite3 backup 能力生成一致性备份。手动备份命名为 `app-manual-YYYYMMDD-HHmmss.db`，不会自动删除。

### [已实现] 获取数据库备份列表
- **用途**：列出当前图片仓库 `metadata/database-backups/` 下的数据库备份文件。
- **请求方法**：`GET`
- **路径**：`/api/settings/database/backups`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": [
      {
        "name": "app-auto-20260521-090000.db",
        "path": "E:\\MediaPhotoWorkspace\\metadata\\database-backups\\app-auto-20260521-090000.db",
        "size": 1234567,
        "createdAt": "2026-05-21T09:00:00.000Z"
      }
    ],
    "error": null
  }
  ```
- **备注**：启动自动备份默认启用，每 24 小时最多一次，自动备份命名为 `app-auto-YYYYMMDD-HHmmss.db`。当前自动保留最近 10 份 `app-auto-*`，不会删除 `app-manual-*` 手动备份。

### [已实现] 迁移数据库位置
- **用途**：将当前数据库复制到新目录或新 `.db` 路径，并更新后续启动使用的数据库路径。
- **请求方法**：`POST`
- **路径**：`/api/settings/database/migrate`
- **请求参数示例**：
  ```json
  {
    "targetDirectory": "E:\\MediaPhotoDatabase"
  }
  ```
  或：
  ```json
  {
    "targetPath": "E:\\MediaPhotoDatabase\\app.db"
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "oldPath": "D:\\project\\Image Workspace\\data\\app.db",
      "newPath": "E:\\MediaPhotoDatabase\\app.db",
      "backupPath": "E:\\MediaPhotoWorkspace\\metadata\\database-backups\\app-migration-20260521-144455.db",
      "requiresRestart": true
    },
    "error": null
  }
  ```
- **错误码**：
  - `INVALID_DATABASE_TARGET`：目标路径为空、与当前路径相同、位于明显不合理目录或目标文件已存在。
  - `REPOSITORY_NOT_CONFIGURED`：迁移前备份需要先配置图片仓库路径。
  - `DATABASE_MIGRATION_FAILED`：迁移、校验或配置写入失败。
- **备注**：迁移前会强制生成 `app-migration-YYYYMMDD-HHmmss.db` 备份。迁移使用 SQLite backup 生成目标数据库并做只读校验，成功后只更新 `config.database.path`，当前进程仍使用旧连接，需重启后生效。旧数据库不会删除；用户图片仓库、`working/`、`archive/` 和原图不会被迁移流程删除。

---

## 三、Events 活动管理

活动列表和协作读取保持局域网可用；活动状态管理、归档 prepare/verify/cleanup、恢复、逻辑删除、永久删除以及归档目录删除属于主机操作，服务端要求请求来自主机本机。

### [已实现] 获取活动列表
- **用途**：获取所有活动的列表。
- **请求方法**：`GET`
- **路径**：`/api/events`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": [],
    "error": null
  }
  ```
- **备注**：返回 SQLite 中真实活动数据；支持 `?status=active|archived|draft|reviewing|all`。

### [已实现] 创建新活动
- **用途**：新建一个活动，并在本地仓库下生成对应的目录结构。
- **请求方法**：`POST`
- **路径**：`/api/events`
- **请求参数示例**：
  ```json
  {
    "name": "2026毕业典礼",
    "slug": "2026-graduation",
    "date": "2026-06-20",
    "location": "学校礼堂"
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "event": {
        "id": "evt_xxx",
        "name": "2026毕业典礼",
        "slug": "2026-graduation",
        "date": "2026-06-20",
        "location": "学校礼堂",
        "status": "active",
        "total_images": 0,
        "selected_images": 0,
        "created_at": "2026-05-13 18:49:07",
        "updated_at": "2026-05-13 18:49:07"
      },
      "workingDir": {
        "created": true,
        "path": "E:\\MediaPhotoWorkspace\\working\\2026-graduation"
      }
    },
    "error": null
  }
  ```
- **错误码**：
  - `MISSING_NAME`：活动名称为空。
  - `MISSING_DATE`：活动日期为空。
  - `SLUG_CONFLICT`：slug 已存在。
  - `REPOSITORY_NOT_READY`：仓库路径未配置、不存在、不可读或不可写。
  - `CREATE_EVENT_DIR_FAILED`：活动工作目录创建失败。
- **备注**：当前实现会先创建完整 `working/{event_slug}` 中文业务目录，再写入活动记录。新建活动默认状态为 `active`。

创建的活动业务目录为：

```text
working/{event_slug}/原图/主机导入
working/{event_slug}/原图/客户端上传
working/{event_slug}/原图/远程导入
working/{event_slug}/缩略图
working/{event_slug}/预览图
working/{event_slug}/待修图
working/{event_slug}/已修图
working/{event_slug}/导出/发布图
working/{event_slug}/导出/压缩图
working/{event_slug}/导出/压缩包
working/{event_slug}/清单
```

### [已实现] 获取活动详情
- **用途**：获取单个活动的信息及统计数据。
- **请求方法**：`GET`
- **路径**：`/api/events/:id`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

### [已实现] 更新活动信息
- **用途**：修改活动的基本信息。
- **请求方法**：`PATCH`
- **路径**：`/api/events/:id`
- **请求参数示例**：
  ```json
  {
    "name": "2026毕业典礼(修改版)"
  }
  ```
- **响应示例**：略
- **备注**：无

### [已实现] 修改活动状态
- **用途**：流转活动状态（如 draft -> active -> reviewing）。
- **请求方法**：`PATCH`
- **路径**：`/api/events/:id/status`
- **请求参数示例**：
  ```json
  {
    "status": "active"
  }
  ```
- **响应示例**：略
- **错误码**：
  - `MISSING_STATUS`：`status` 为空。
  - `INVALID_STATUS`：状态不在 `draft | active | reviewing | archived | deleted` 中。
  - `EVENT_NOT_FOUND`：活动不存在。
  - `FTP_EVENT_NOT_ALLOWED`：该活动是当前 FTP 接收活动，不能变为 `archived | deleted`。
- **备注**：该接口只修改活动状态，不移动或删除工作区文件。当前 FTP 活动必须先切换或解除关联。

### [已实现] 逻辑删除活动
- **用途**：把活动标记为已删除，使其不再出现在默认活动列表中。
- **请求方法**：`DELETE`
- **路径**：`/api/events/:id`
- **请求参数示例**：无
- **响应示例**：返回状态为 `deleted` 的活动对象。
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `FTP_EVENT_NOT_ALLOWED`：该活动仍是当前 FTP 接收活动。
  - `DELETE_EVENT_FAILED`：删除失败。
- **备注**：这是逻辑删除，只写入 `status = deleted`，不删除 SQLite 记录、不删除原图、不删除缩略图/预览图、不清理活动工作区。

### [已实现] 获取活动回收站列表
- **用途**：查看已逻辑删除的活动，支持恢复或永久删除。
- **请求方法**：`GET`
- **路径**：`/api/events/trash`
- **请求参数示例**：无
- **响应示例**：返回 `status = deleted` 的活动数组。
- **备注**：只返回 `status = deleted` 的活动。

### [已实现] 恢复已删除活动
- **用途**：将回收站中的活动恢复为可用状态。
- **请求方法**：`PATCH`
- **路径**：`/api/events/:id/restore`
- **请求参数示例**：
  ```json
  { "status": "active" }
  ```
- **响应示例**：返回恢复后的活动对象。
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_DELETED`：活动不在回收站中。
  - `INVALID_RESTORE_STATUS`：恢复目标不是 `active | draft`。
- **备注**：图片仍通过 `event_id` 归属该活动，恢复时不移动图片文件，也不自动将其设为 FTP 接收活动。

### [已实现] 永久删除活动及工作区
- **用途**：彻底删除活动记录、图片记录和对应工作区文件。
- **请求方法**：`DELETE`
- **路径**：`/api/events/:id/purge`
- **请求参数示例**：
  ```json
  { "includeArchive": false }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "eventId": "evt_xxx",
      "deletedFiles": ["E:\\仓库\\working\\活动\\原图\\..."],
      "deletedRecords": {
        "events": 1,
        "images": 12,
        "imageTags": 0,
        "downloadLogs": 3,
        "exportJobs": 2,
        "operationLogs": 24,
        "archivedEvents": 1
      },
      "missingFiles": [],
      "errors": [],
      "workingPath": "E:\\仓库\\working\\活动",
      "archivePath": "E:\\仓库\\archive\\活动"
    },
    "error": null
  }
  ```
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_DELETED`：活动不在回收站中。
  - `REPOSITORY_NOT_READY`：仓库路径不可用。
  - `EVENT_PURGE_PATH_OUTSIDE_REPOSITORY`：删除目标不在受控 working/archive 根目录内。
  - `EVENT_PURGE_PATH_OVERLAP`：待删除的受控目录相互嵌套，拒绝开始隔离。
  - `EVENT_PURGE_FILE_STAGE_FAILED` / `EVENT_PURGE_STAGE_ROLLBACK_FAILED`：目录隔离失败，数据库未修改；后者表示隔离回滚不完整。
  - `EVENT_PURGE_DATABASE_FAILED` / `EVENT_PURGE_DATABASE_ROLLBACK_FAILED`：数据库事务失败；后者表示隔离目录未完全恢复。
  - `FTP_EVENT_NOT_ALLOWED`：该活动仍是当前 FTP 接收活动。
- **崩溃恢复**：首次移动文件前会在仓库 `.mpw-purge-journal/` 原子写入恢复日志。服务启动并打开数据库后、开放 API 和恢复 watcher 前处理未完成 journal：SQLite 中活动仍存在时恢复原目录，活动已不存在时继续清理隔离目录；无法安全处理的 journal 保留并记录待重试状态。
- **备注**：仅允许对 `status = deleted` 的活动执行。前端必须二次确认并建议输入活动名称。默认处理 `working/{event_slug}` 和对应 `archive/{event_slug}` / `archive/{event_slug}_*`；如明确传 `includeArchive = false` 才保留归档目录。服务端先将受控目录原子移动到同父目录隔离名，再在单一事务中清理该活动的 `images`、`image_tags`、`download_logs`、`export_jobs`、`operation_logs`、`camera_ftp_file_receipts`、`archived_events` 和 `events`。事务失败会恢复目录；事务提交后的隔离目录删除失败时仍返回 `ok = true`，但 `errors` 非空并给出保留位置，前端必须显示部分成功警告，不能宣称文件已全部清理。

### [已实现] 准备活动归档
- **用途**：执行活动归档准备流程。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/prepare`
- **请求参数示例**：无
- **响应示例**：返回归档目录、缩略图复制数量、缺失文件、`manifestPath` 和 `eventDbPath`。
- **备注**：生成轻量归档 `archive/{event_slug}`，只复制缩略图到 `缩略图/`，并生成 `metadata/manifest.json`、`images.csv`、`operation_logs.csv` 和独立 `event.db`；原图、已修图、发布图和压缩包只记录历史路径，不复制进归档。当前 FTP 接收活动返回 `FTP_EVENT_NOT_ALLOWED`。

### [已实现] 获取已归档活动列表
- **用途**：获取历史已归档的只读活动列表摘要。
- **请求方法**：`GET`
- **路径**：`/api/archived-events`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

### [已实现] 获取已归档活动详情
- **用途**：在 working 工作区已清理后，只读打开历史归档活动。
- **请求方法**：`GET`
- **路径**：`/api/archived-events/:id`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "archivedEvent": {
        "id": "arch_evt_xxx",
        "event_id": "evt_xxx",
        "event_name": "活动名称",
        "event_slug": "event_slug",
        "event_date": "2026-05-15",
        "total_images": 12,
        "edited_images": 5,
        "published_images": 3,
        "archive_path": "E:\\仓库\\archive\\event_slug",
        "archived_at": "2026-05-15 12:00:00"
      },
      "event": {
        "id": "evt_xxx",
        "name": "活动名称",
        "slug": "event_slug",
        "date": "2026-05-15",
        "status": "archived"
      },
      "archivePath": "E:\\仓库\\archive\\event_slug",
      "archivedAt": "2026-05-15 12:00:00",
      "counts": {
        "total_images": 12,
        "thumb_files": 12,
        "original_files": 0,
        "edited_files": 0,
        "export_files": 0,
        "missing_files": 0
      },
      "files": [],
      "images": [],
      "missingFiles": [],
      "metadataFiles": [
        { "name": "manifest.json", "path": "E:\\仓库\\archive\\event_slug\\metadata\\manifest.json", "exists": true, "size": 1024 }
      ]
    },
    "error": null
  }
  ```
- **错误码**：
  - `ARCHIVED_EVENT_NOT_FOUND`：归档摘要不存在。
  - `ARCHIVE_PATH_NOT_FOUND`：`archive_path` 目录不存在。
  - `ARCHIVE_MANIFEST_NOT_FOUND`：`metadata/manifest.json` 不存在。
- **备注**：只读接口，不修改 `archive`、`archived_events` 或原始 `events/images` 记录；轻量归档下原图/已修图未保留属于预期状态，不计入缺失；某个归档缩略图或 metadata 文件缺失会进入 `missingFiles`，不会导致整个接口崩溃。

### [已实现] 获取归档缩略图
- **用途**：只读归档页显示历史活动缩略图。
- **请求方法**：`GET`
- **路径**：`/api/archived-events/:id/thumb/:imageId`
- **请求参数示例**：无
- **响应示例**：返回 WebP 文件流。
- **错误码**：
  - `ARCHIVED_EVENT_NOT_FOUND`：归档摘要不存在。
  - `ARCHIVE_PATH_NOT_FOUND`：归档目录不存在。
  - `ARCHIVE_MANIFEST_NOT_FOUND`：`manifest.json` 不存在。
  - `ARCHIVE_THUMB_NOT_FOUND`：对应归档缩略图不存在。

### [已实现] 删除归档活动
- **用途**：删除只读归档目录和 `archived_events` 摘要，释放归档占用空间。
- **请求方法**：`DELETE`
- **路径**：`/api/archived-events/:id`
- **请求参数示例**：无
- **响应示例**：返回 `archivePath`、是否删除目录、缺失文件和删除的归档摘要记录数。
- **备注**：只删除 archive 归档目录和归档摘要，不删除原活动 `events/images` 记录；前端必须二次确认。
- **错误码补充**：`FTP_EVENT_NOT_ALLOWED` 表示该归档对应的活动仍是当前 FTP 接收活动，必须切换活动，或先停止 FTP 后独立解除关联。

---

## 四、Images 图片管理

### [已实现] 获取活动下的图片列表
- **用途**：获取某活动下的图片库，支持筛选和分页。
- **请求方法**：`GET`
- **路径**：`/api/events/:eventId/images`
- **查询参数**：
  - `page`：页码，默认 `1`。
  - `pageSize`：每页数量，默认 `80`，最大 `200`。
  - `rating`：星级筛选值，支持 `0-5`。默认配合 `ratingMode=gte` 表示最低星级。
  - `ratingMode`：星级匹配方式，支持 `gte | eq`。不传时默认 `gte`，保持旧版“几星及以上”行为；`eq` 表示精确匹配某个星级，例如 `rating=3&ratingMode=eq` 只返回 3 星图片。
  - `status`：图片状态，支持 `unselected | rejected | archive | edit | edited | publish | published`。
  - `source_type`：图片来源，常用 `host_import` 或 `client_upload`。
  - `uploadedByClientId`：上传者筛选；传具体客户端 `clientId` 时只返回该客户端上传图片，传 `host` 时返回主机导入图片。
  - `keyword`：关键字，匹配文件名、分类、备注、摄影师、相机和镜头字段。
- **请求参数示例**：`?page=1&pageSize=80&rating=4&ratingMode=gte&source_type=client_upload&uploadedByClientId=client_xxx&keyword=现场`
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "items": [
        {
          "id": "img_xxx",
          "event_id": "evt_xxx",
          "original_filename": "IMG_0001.JPG",
          "stored_filename": "event_20260513_200000_img_xxx_IMG_0001.JPG",
          "thumb_url": "http://localhost:3030/api/images/img_xxx/thumb",
          "preview_url": "http://localhost:3030/api/images/img_xxx/preview",
          "file_size": 7280010,
          "width": 6000,
          "height": 4000,
          "shot_at": "2026-05-13 19:30:00",
          "imported_at": "2026-05-13 20:00:00",
          "rating": 4,
          "status": "publish",
          "category": "现场",
          "remark": "可发布",
          "photographer": "",
          "camera_model": "NIKON Z 6_3",
          "lens_model": "",
          "source_type": "host_import",
          "uploaded_by_client_id": "host",
          "uploaded_by_name": "主机导入",
          "uploaded_by_role": "host",
          "uploaded_at": "2026-05-13 20:00:00",
          "edited_available": false,
          "original_exists": true,
          "thumb_exists": true,
          "preview_exists": true,
          "edited_exists": false,
          "is_deleted": false,
          "deleted_at": ""
        }
      ],
      "total": 1,
      "page": 1,
      "pageSize": 80
    },
    "error": null
  }
  ```
- **错误码**：
  - `INVALID_STATUS`：传入的状态不在允许范围内。
- **备注**：当前未实现标签筛选；默认只返回 `is_deleted = 0` 的图片。`uploadedByClientId` 可与星级、状态、来源和关键字组合，分页 `total` 按数据库筛选结果计算。缩略图和预览图使用 `thumb_url` / `preview_url` 访问，原图、预览图下载和已修图下载使用 Download 下载接口。

### [已实现] 获取活动上传来源 / 上传者统计
- **用途**：图片墙筛选区生成“上传来源 / 上传者”选项。
- **请求方法**：`GET`
- **路径**：`/api/events/:eventId/uploaders`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": [
      {
        "clientId": "host",
        "clientName": "主机导入",
        "sourceType": "host_import",
        "count": 456
      },
      {
        "clientId": "7f0f0a52-1111-4a2a-8888-123456789abc",
        "clientName": "修图电脑A",
        "sourceType": "client_upload",
        "count": 123
      }
    ],
    "error": null
  }
  ```
- **备注**：该接口基于当前活动 `images` 记录统计，不要求客户端在线；设备名可能重复，筛选应优先使用 `clientId`。

### [已实现] 获取缩略图
- **用途**：按图片 ID 获取长边 400px 的 WebP 缩略图。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/thumb`
- **请求参数示例**：无
- **响应示例**：返回 WebP 文件流。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片记录不存在。
  - `IMAGE_FILE_NOT_FOUND`：缩略图文件不存在。
- **备注**：后端按 `image.id` 查询 `thumb_path` 后 `sendFile`，不会直接暴露整个仓库目录。

### [已实现] 获取预览图
- **用途**：按图片 ID 获取长边 1600px 的 WebP 预览图。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/preview`
- **请求参数示例**：无
- **响应示例**：返回 WebP 文件流。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片记录不存在。
  - `IMAGE_FILE_NOT_FOUND`：预览图文件不存在。
- **备注**：这是用于页面展示的预览图访问接口；下载预览图请使用 `/api/images/:id/download/preview`。

### [已实现] 修改图片星级
- **用途**：打星 (0-5)。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/rating`
- **请求参数示例**：
  ```json
  {
    "rating": 5,
    "actor": { "type": "client", "id": "client_xxx", "name": "修图电脑A" }
  }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
  - `INVALID_RATING`：`rating` 不是 0-5 的整数。
- **备注**：更新 `images.updated_at`，并写入 `operation_logs`。前端也可通过 `X-Actor-Type`、`X-Actor-Id`、`X-Actor-Name` 请求头传递操作者；主机端默认 `actor_type = host`、`actor_name = 主机`。

### [已实现] 修改图片状态
- **用途**：修改图片流转状态 (unselected, rejected, edit, publish 等)。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/status`
- **请求参数示例**：
  ```json
  {
    "status": "publish",
    "actor": { "type": "host", "id": "host", "name": "主机" }
  }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
  - `INVALID_STATUS`：状态不在允许范围内。
- **备注**：允许状态为 `unselected | rejected | archive | edit | edited | publish | published`。更新 `images.updated_at`，并写入 `operation_logs.actor_type / actor_id / actor_name`；旧 `operator/device` 字段继续保留兼容。

### [已实现] 修改图片分类
- **用途**：更改图片的主分类。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/category`
- **请求参数示例**：
  ```json
  {
    "category": "现场特写",
    "actor": { "type": "client", "id": "client_xxx", "name": "摄影组1号" }
  }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
- **备注**：分类会 trim 后保存；允许保存为空字符串。更新 `images.updated_at`，并写入带 actor 字段的 `operation_logs`。

### [计划中] 修改图片标签
- **用途**：为图片增减多维度标签。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/tags`
- **请求参数示例**：
  ```json
  { "tags": ["校长", "颁奖"] }
  ```
- **响应示例**：略
- **备注**：无

### [已实现] 修改图片备注
- **用途**：为图片添加修图意见等备注说明。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/remark`
- **请求参数示例**：
  ```json
  {
    "remark": "注意提亮暗部",
    "actor": { "type": "host", "id": "host", "name": "主机" }
  }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
- **备注**：备注会 trim 后保存；允许保存为空字符串。更新 `images.updated_at`，并写入带 actor 字段的 `operation_logs`。

### [已实现] 逻辑删除图片
- **用途**：将图片从图片墙移除，但不删除仓库中的任何物理文件。
- **请求方法**：`DELETE`
- **路径**：`/api/images/:id`
- **请求参数示例**：无；可选 actor 请求头 `X-Actor-Type`、`X-Actor-Id`、`X-Actor-Name`。
- **响应示例**：返回 `is_deleted = true` 的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
- **备注**：该接口只写入 `images.is_deleted = 1` 和 `deleted_at`，并写入 `operation_logs.type = image_deleted_logical` 和 actor 字段。默认图片查询不会再返回已逻辑删除图片。

### [已实现] 查询图片回收站
- **用途**：查看某个活动下已逻辑删除的图片。
- **请求方法**：`GET`
- **路径**：`/api/events/:eventId/images/trash`
- **请求参数示例**：
  ```text
  ?page=1&pageSize=80
  ```
- **响应示例**：分页返回 `is_deleted = 1` 的图片，字段与普通图片查询保持一致，并额外包含 `original_path`、`thumb_path`、`preview_path`、`edited_path`，用于永久删除前展示。
- **备注**：仅回收站视图返回文件路径，普通图片墙查询不暴露路径。

### [已实现] 恢复图片
- **用途**：把回收站图片恢复到图片墙。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/restore`
- **请求参数示例**：无；可选 actor 请求头 `X-Actor-Type`、`X-Actor-Id`、`X-Actor-Name`。
- **响应示例**：返回恢复后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
  - `IMAGE_NOT_DELETED`：图片不在回收站中。
- **备注**：恢复会写入 `operation_logs.type = image_restored` 和 actor 字段，并广播 `image-updated`。

### [已实现] 永久删除图片
- **用途**：永久删除回收站图片记录及其关联文件。
- **请求方法**：`DELETE`
- **路径**：`/api/images/:id/purge`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "imageId": "img_xxx",
      "eventId": "evt_xxx",
      "deletedFiles": ["E:\\仓库\\working\\活动\\缩略图\\img_xxx.webp"],
      "missingFiles": [],
      "errors": [],
      "deletedRecords": 1
    },
    "error": null
  }
  ```
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
  - `IMAGE_NOT_DELETED`：图片不在回收站中。
- **备注**：仅允许对 `is_deleted = 1` 的图片执行。文件不存在会进入 `missingFiles`，不会直接导致整个请求失败；如果某个文件仍被其他图片记录引用，后端会保留该文件并返回 warning。

---

## 四点五、Camera FTP 相机 FTP 传输

前端入口位于“导入图片 > 相机 FTP”。当前实现仅由 Windows IIS 提供 FTP 服务。普通状态读取不弹 UAC；只有 discover-sites、setup、adopt-site、start、stop、restart、repair、credentials 和需要改变 IIS physicalPath 的 active-event 操作才可能请求提权。其中 discover-sites 只读，不修改 IIS。

该命名空间仅允许主机本机调用。普通 FTP 是明文协议，只面向可信局域网或 Windows 热点；账户应使用不复用的专用密码。PASV `50000-50100` 是 IIS 服务器级配置，setup、repair 和 adopt-site 的确认界面必须提示它可能影响本机其他 IIS FTP 站点。

当前实现的 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/camera-ftp/status` | 只读检测 Windows 功能、FTPSVC、IIS 站点、账户、ACL、防火墙、当前控制端口、网络地址、当前活动和 watcher |
| `GET` | `/api/camera-ftp/diagnostics` | 只读生成字段白名单的相机 FTP 脱敏诊断；不请求 UAC，不返回密码、账户详情、图片/FTP 完整路径、最近文件名或其他 IIS 站点配置 |
| `POST` | `/api/camera-ftp/provisioning-plan` | 只读生成 setup / repair / start / restart / adopt-site 的结构化配置计划；不传密码、不创建目录、不请求 UAC |
| `POST` | `/api/camera-ftp/check-port` | 校验控制/被动端口并返回监听 PID、进程、IIS 站点归属、保留端口状态和候选可用端口；`fullInspection: true` 会按需请求 UAC 做只读 IIS binding 检测，不修改系统 |
| `POST` | `/api/camera-ftp/discover-sites` | 普通检测不完整时按需请求 UAC，只读列出可明确选择接管的 IIS FTP 站点 |
| `POST` | `/api/camera-ftp/setup` | 接收活动、账户、控制端口和被动端口，用户确认后自动请求 UAC；冲突预检通过后完成配置与启动 |
| `POST` | `/api/camera-ftp/adopt-site` | 在用户明确确认后接管指定现有 IIS FTP 站点；不删除旧目录 |
| `POST` | `/api/camera-ftp/start` | 使用统一 reconciliation 检查并自动修复工作台配置，再启动 FTPSVC/目标站点；watcher 在验证成功后衔接 |
| `POST` | `/api/camera-ftp/stop` | 停止目标 IIS FTP 站点，不停止 watcher |
| `POST` | `/api/camera-ftp/restart` | 使用统一 reconciliation 校正工作台配置并重启目标站点 |
| `POST` | `/api/camera-ftp/repair` | 用户确认 UAC 后按检测结果修复项目管理配置 |
| `PATCH` | `/api/camera-ftp/credentials` | 设置用户名和新密码；密码不进入响应或持久化配置 |
| `PATCH` | `/api/camera-ftp/active-event` | 事务化切换当前 FTP 活动、IIS physicalPath 和 watcher；解除关联必须先停止 FTP，接口本身不停止站点且保留目录和文件 |
| `POST` | `/api/camera-ftp/open-folder` | 打开当前活动 `working/{event_slug}/原图/相机FTP/` |

`GET /status` 的 `data` 至少包含 `inspectionLevel / inspectionOutcome / inspectionSource / inspectedAt / requiresAdminForFullInspection / requiresAdminForSystemChanges / startupRecovery / provider / platform / windowsFeatures / service / site / account / activeEvent / ftpPath / watcher / conflicts / warnings / initialized / passwordConfigured`。普通权限不能读取 IIS `applicationHost.config` 时仍返回 `ok=true`、`inspectionLevel=partial`、`inspectionOutcome=partial|admin_required`、`site.status=unknown`，不会把 `ADMIN_REQUIRED` 当成全局失败；系统修改按钮可继续触发按需 UAC。`inspectionSource` 明确本次事实来自普通或管理员检测，前端可另存最近一次管理员完整检测用于参考，但不得覆盖较新的普通检测结果。`startupRecovery` 只报告只读恢复决策与结果；启动期间不请求 UAC，不执行 setup/repair/adopt，也不创建缺失目录。

`watcher.busy` 是切换与解除关联的权威运行时忙碌标志，覆盖候选 reservation、稳定检测、等待队列、批次计时器和已开始导入；兼容字段 `pendingCount / queuedCount / importingCount / unstableCount` 继续保留用于展示。只要 `busy=true`，活动切换和解除关联必须返回 `FTP_UPLOAD_IN_PROGRESS`。

`GET /diagnostics` 的 `data` 只包含 `generatedAt / operationId / diagnosticRequestOperationId / platform / ftp`。`ftp` 仅允许 provider、托管站点名/Site ID、非敏感端口、当前活动 ID/名称、inspection、initialized/requiresAdmin、watcher 运行/忙碌/计数/最近扫描时间和最近错误码。该接口不读取或回传 FTP 密码、SecureString、账户状态详情、`ftpPath`、watcher directory/recentRecords、图片内容、提权临时文件或无关 IIS 站点；设置页复制前还会再次隐藏用户目录和 secret/password 文本。

`PATCH /active-event` 请求体为 `{ "eventId": "evt_target" }`。服务端复用 API 请求的父 `operationId` 记录 `validate_target_event / check_pending_uploads / snapshot_current_state / prepare_target_directory / update_iis_physical_path / switch_watcher / verify_switched_state / commit_active_event`；IIS/PowerShell 子事务保留独立 `childOperationId` 和 `parentOperationId`，继续记录 `update_target_acl / stop_ftp_site / restart_ftp_site` 或 `preserve_stopped_site`。provisioning、verify、rollback、日志和前端错误展示沿用同一父子关联。原站点为停止状态时，切换后必须保持停止，且不要求控制端口监听。`activeEventId` 只能在最终验证后提交；失败响应的 rollback items 明确列出 `rollback_physical_path / rollback_site_state / rollback_watcher / rollback_active_event`。前端不得把请求中的 eventId 当作已生效状态，刷新后必须以 `GET /status` 的真实 `activeEvent.id` 为准。

提权脚本失败时，统一错误响应的 `error.details` 可包含：`operationId / childOperationId / parentOperationId / operation / scriptName / stage / technicalMessage / exceptionType / command / siteName / rollbackAttempted / rollbackSucceeded / systemStateUnknown / warnings / timestamp / exitCode / conflict / diagnostics / completedSteps / failedStep / rollback / preflight / provisioningPlan`。`conflict` 保留端口、PID、进程、IIS 站点、来源、建议、候选端口等兼容字段；`diagnostics` 在最终验证失败时包含 `failedChecks / failedCodes / verificationChecks`。管理员脚本内部可以使用路径完成验证，但 API 错误与前端复制详情会把 path/directory/filename 和 Windows 绝对路径替换为脱敏占位。任何字段都不得包含 password/passphrase/secret/token/SecureString/credential、输入 JSON 内容或完整敏感命令行。前端应根据具体检查码显示中文原因，不能直接把原始英文 PowerShell 文本作为主错误。`rollback.status` 只使用 `success / partial / failed / not_required`；发生部分回滚失败时不得显示“已完全恢复”。提权结果缺少 `ok / operation / stage / timestamp / data` 等必要字段时返回 `ELEVATED_RESULT_INVALID_SCHEMA`，不得把不完整 JSON 当成成功。

`POST /provisioning-plan` 请求示例：`{ "goal": "setup", "eventId": "evt_xxx", "username": "camera", "controlPort": 21, "passivePortStart": 50000, "passivePortEnd": 50100 }`。响应包含 `planId / target / targetState / summary / items / issues / confirmations / requiresAdmin / canApply / preflight`。每个 item 的状态为 `already_ok / create / update / repair / user_confirmation_required / blocked`；计划阶段只计算并读取状态，不创建 `原图/相机FTP` 目录、不保存配置、不启动 watcher。管理员脚本会在 Apply 前重复 authoritative Preflight，防止普通权限计划过期后误改外部资源。

setup 请求体为 `{ "eventId": "evt_xxx", "username": "camera", "password": "...", "confirmPassword": "...", "controlPort": 21, "passivePortStart": 50000, "passivePortEnd": 50100, "confirm": true, "allowAclTightening": false }`。repair 在托管账户缺失、密码未配置或需要重置时可附带本次一次性的 `password`；后端只用于本轮管理员脚本。密码至少 8 位，不得回显或持久化。`allowAclTightening` 只在计划已经展示宽泛写权限且用户确认后为 `true`，不持久化；工作台只收紧目标目录上的宽泛写入规则，保留 SYSTEM、Administrators、当前用户、FTP 账户和其他合法 ACL。setup/repair/adopt-site 在冲突预检通过前不得执行破坏性修改；无关 IIS 站点和其他进程不会被修改或停止，可接管站点也必须由用户明确调用 adopt-site。候选端口只作建议，不自动写回。

如预检发现早期版本创建、内部名称不是当前稳定名称的本地 FTP 防火墙规则需要变更，接口返回 `409 FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED`，且不执行 IIS、账户、ACL 或防火墙修改。前端显示规则差异并取得第二次明确确认后，原请求可附加 `"allowLegacyFirewallRuleUpdate": true` 重新提交；该布尔值仅授权本次列出的本地旧规则更新，不保存到 `cameraFtp` 配置。`PolicyStoreSourceType` 不是 `Local`、规则重名无法唯一识别或由策略管理时返回 `FIREWALL_RULE_POLICY_BLOCKED`，即使携带确认标志也不得强制修改。

`POST /check-port` 的普通请求在无法读取 IIS 配置时返回 `inspectionLevel: "partial"`、`requiresAdminForFullInspection: true` 和 `port.conflict: null`；前端不得把该状态显示为“可用”。用户明确点击检测后发送 `fullInspection: true`，工作台请求 UAC 并只读检查已停止站点的 FTP binding。

主要错误码：`UNSUPPORTED_PLATFORM`、`IIS_FTP_NOT_INSTALLED`、`WINDOWS_RESTART_REQUIRED`、`IIS_SITE_NOT_FOUND`、`IIS_SITE_CONFLICT`、`IIS_SITE_ADOPTION_REQUIRED`、`FTP_CONTROL_PORT_INVALID`、`FTP_CONTROL_PORT_IN_USE`、`FTP_CONTROL_PORT_RESERVED`、`FTP_PORT_RANGE_CONFLICT`、`IIS_SITE_PORT_CONFLICT`、`PORT_USED_BY_OTHER_PROCESS`、`NO_AVAILABLE_FTP_PORT`、`FTP_ACCOUNT_CONFLICT`、`FTP_PASSWORD_REQUIRED`、`FTP_PASSWORD_INVALID`、`FTP_EVENT_NOT_FOUND`、`FTP_EVENT_NOT_ALLOWED`、`FTP_UPLOAD_IN_PROGRESS`、`CAMERA_FTP_SWITCH_IN_PROGRESS`、`FTP_EVENT_SWITCH_FAILED`、`FTP_SITE_STOP_FAILED`、`FTP_TARGET_ACL_UPDATE_FAILED`、`FTP_PHYSICAL_PATH_UPDATE_FAILED`、`FTP_WATCHER_SWITCH_FAILED`、`FTP_SITE_RESTART_FAILED`、`FTP_SWITCH_VERIFY_FAILED`、`FTP_SWITCH_ROLLBACK_FAILED`、`FTP_ACTIVE_EVENT_STATE_MISMATCH`、`FTP_SERVICE_MUST_BE_STOPPED`、`FTP_SERVICE_STATE_UNKNOWN`、`FTP_SETUP_REQUIRED`、`FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED`、`FIREWALL_RULE_POLICY_BLOCKED`、`FIREWALL_CONFIG_FAILED`、`FIREWALL_RULE_MISMATCH`、`FIREWALL_ROLLBACK_VERIFY_FAILED`、`IIS_FTP_SERVICE_START_FAILED`、`IIS_FTP_SITE_START_FAILED`、`IIS_FTP_SITE_STOP_FAILED`、`IIS_FTP_LISTENER_START_FAILED`、`IIS_FTP_FEATURE_MISSING`、`FTP_SERVICE_NOT_FOUND`、`FTP_SERVICE_NOT_RUNNING`、`SITE_NOT_STARTED`、`CONTROL_PORT_NOT_LISTENING`、`CONTROL_PORT_LISTENER_OWNERSHIP_MISMATCH`、`SITE_BINDING_MISMATCH`、`PHYSICAL_PATH_MISMATCH`、`MANAGED_SITE_ID_MISMATCH`、`FTP_ACCOUNT_STATE_MISMATCH`、`FTP_ACCOUNT_PASSWORD_UPDATE_FAILED`、`FTP_ACCOUNT_PERMISSION_FAILED`、`FTP_DIRECTORY_ACL_NONCANONICAL`、`FTP_DIRECTORY_ACL_TIGHTENING_MISMATCH`、`IIS_AUTH_CONFIGURATION_MISMATCH`、`FTP_AUTHORIZATION_MISMATCH`、`PASSIVE_PORT_MISMATCH`、`FTP_CONFIGURATION_VERIFICATION_FAILED`、`ACTIVE_EVENT_ID_MISMATCH`、`CAMERA_FTP_CONFIG_SAVE_MISMATCH`、`CAMERA_FTP_WATCHER_NOT_RUNNING`、`CAMERA_FTP_WATCHER_TARGET_MISMATCH`、`CAMERA_FTP_NODE_STATE_MISMATCH`、`ADMIN_REQUIRED`、`UAC_CANCELLED`、`ELEVATED_SCRIPT_LAUNCH_FAILED`、`ELEVATED_SCRIPT_NO_RESULT`、`ELEVATED_RESULT_INVALID_JSON`、`ELEVATED_SCRIPT_TIMEOUT`、`IIS_CONFIG_FAILED`。`WINDOWS_RESTART_REQUIRED` 表示 Windows 功能已保留启用结果，但在账户、ACL、IIS 站点、防火墙和服务修改前安全暂停；重启 Windows 后重新执行即可，不应显示为普通配置失败。

自动导入规则：IIS 把 JPG/JPEG 直接写入 `working/{event_slug}/原图/相机FTP/`，watcher 按文件大小和 mtime 稳定性检测，随后以原路径和原文件名写入 `images.original_path/stored_filename`，只生成衍生图与数据库记录。应用退出只关闭 watcher，不停止 IIS 站点或 FTPSVC。

本阶段新增的稳定错误码包括：`ELEVATED_RESULT_INVALID_SCHEMA`、`ELEVATED_STATE_UNKNOWN`、`FTP_UNLINK_ROLLBACK_FAILED`、`IMAGE_DATABASE_WRITE_FAILED`、`IMAGE_THUMBNAIL_FAILED`、`IMAGE_PREVIEW_FAILED`、`IMAGE_HASH_FAILED`、`IMAGE_ORIGINAL_UNAVAILABLE`。数据库或衍生图失败时原图保留、图片不得虚假落库为成功；任务中心与 Socket.IO 属于旁路诊断，失败不得回滚已经安全提交的图片。

### 历史接口说明

IIS FTP 迁移前的内置接收服务接口、响应示例和配置规则已从当前 API 规范移除。它们不属于现行合同；迁移与版本演进只在变更日志中保留摘要。当前实现仅以上述 IIS FTP API、可配置控制端口和 `原图/相机FTP/` 最终目录为准。
## 五、Import 图片导入

### [已实现] 扫描待导入目录
- **用途**：扫描主机本地目录，返回可导入的 JPG/JPEG/PNG 文件数量、总大小和文件列表摘要。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/import/scan`
- **请求参数示例**：
  ```json
  { "folderPath": "E:\\SD_Card\\DCIM" }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "eventId": "evt_xxx",
      "folderPath": "E:\\SD_Card\\DCIM",
      "count": 2,
      "totalSize": 14583210,
      "files": [
        {
          "filename": "IMG_0001.JPG",
          "path": "E:\\SD_Card\\DCIM\\IMG_0001.JPG",
          "size": 7280010,
          "extension": ".jpg"
        }
      ]
    },
    "error": null
  }
  ```
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_IMPORTABLE`：活动已归档或删除，不能导入。
  - `INVALID_FOLDER_PATH`：`folderPath` 为空或不是字符串。
  - `FOLDER_NOT_FOUND`：源文件夹不存在。
  - `NOT_A_DIRECTORY`：路径不是文件夹。
- **备注**：第一版只扫描当前文件夹第一层，不递归子目录。只识别 `.jpg` / `.jpeg` / `.png`。

### [已实现] 开始导入任务
- **用途**：创建主机本地 JPG/JPEG/PNG 后台导入任务，支持文件夹导入或指定图片文件导入。任务异步复制原图、生成缩略图和预览图、读取可用 EXIF/元数据、写入数据库，并通过任务中心实时展示进度。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/import/start`
- **请求参数示例（文件夹导入）**：
  ```json
  { "folderPath": "E:\\SD_Card\\DCIM" }
  ```
- **请求参数示例（指定文件导入）**：
  ```json
  {
    "filePaths": [
      "E:\\SD_Card\\DCIM\\IMG_0001.JPG",
      "E:\\SD_Card\\DCIM\\poster.png"
    ]
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "taskId": "task_xxx",
      "total": 4000,
      "mode": "folder"
    },
    "error": null
  }
  ```
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_IMPORTABLE`：活动已归档或删除，不能导入。
  - `INVALID_IMPORT_SOURCE`：未提供 `folderPath` 或 `filePaths`。
  - `INVALID_FOLDER_PATH`：`folderPath` 为空或不是字符串。
  - `INVALID_FILE_PATHS`：`filePaths` 不是非空数组。
  - `FOLDER_NOT_FOUND`：源文件夹不存在。
  - `NOT_A_DIRECTORY`：路径不是文件夹。
  - `REPOSITORY_NOT_READY`：仓库路径未配置、不存在、不可读或不可写。
  - `MISSING_IMAGE_PROCESSOR`：缺少 `sharp` 依赖。
- **备注**：
  - v0.15.0-rc.0 起该接口返回 `taskId`，导入处理在后台任务中执行，前端不再长时间等待整个批次完成。
  - 任务进度可通过 `GET /api/tasks/:taskId` 查询，也会通过 Socket.IO `task-updated` 推送到任务中心。
  - 传入 `folderPath` 时只扫描当前文件夹第一层；传入 `filePaths` 时只导入手动指定的文件，不扫描整个文件夹。
  - 不移动、不删除、不覆盖源文件。
  - 原图复制到 `working/{event_slug}/原图/主机导入`。
  - 缩略图写入 `working/{event_slug}/缩略图/{imageId}.webp`，长边 400px。
  - 预览图写入 `working/{event_slug}/预览图/{imageId}.webp`，长边 1600px。
  - 通过 sha256 `file_hash` 在同一活动内去重，当前活动已有相同图片时计入 `skipped`。
  - EXIF 读取失败不会导致导入失败。
  - 指定文件导入中，不存在、非文件或非 JPG/JPEG/PNG 的路径会进入 `errors`，不会中断整个批次。
  - 导入任务支持有限并发处理、进度统计、预计剩余时间和取消；取消后已成功导入的图片保留，未处理图片停止导入。
  - v0.16.0 开发阶段 16.4 起，主机导入页支持拖拽图片文件或文件夹。拖拽图片文件最终仍通过 `filePaths` 提交；拖拽文件夹仍通过 `folderPath` 扫描第一层图片，不新增 API。

### [已实现] 获取任务列表
- **用途**：获取当前运行期内的任务列表。
- **请求方法**：`GET`
- **路径**：`/api/tasks`
- **请求参数示例**：无
- **响应示例**：返回任务数组，按创建时间倒序。
- **备注**：v0.10.0-dev 第一版任务系统使用内存存储，应用重启后任务记录会清空。
- **统一统计字段**：v0.16.0 开发阶段起，前端任务中心和业务页面统一读取以下字段：
  - `total`：任务总量。
  - `finished`：已处理数量。
  - `successCount`：成功数量。
  - `failedCount`：失败数量。
  - `skippedCount`：跳过数量。
  - `elapsedMs`：已用时间。
  - `estimatedRemainingMs`：预计剩余时间，可为 `null`。
  - `currentFileName`：当前处理文件名，可为空。
  - `errors`：错误摘要，导入等大批量任务最多保留前若干条。
  - `result.total / result.success / result.failed / result.skipped`：任务完成后的业务结果字段；前端会兼容这些字段并映射为同一套统计。
- **当前接入任务中心的任务类型**：
  - `host_import`：主机图片导入。
  - `client_upload_import`：客户端上传后的主机端图片处理。
  - `camera_ftp_import`：相机 FTP 接收目录自动导入。
  - `download_zip`：批量 ZIP 下载。
  - `publish_export`：发布导出。
  - `edit_package`：待修包生成。
  - `edited_upload`：已修图回传处理。
  - `archive_prepare`：活动归档生成。
  - `archive_cleanup`：归档后清理工作区。
- **任务结果字段**：`result` 由具体任务写入，可能包含 `downloadUrl`、`downloadName`、`outputDir`、`zipPath`、`packagePath`、`items`、`errors` 等业务结果。任务状态变化会通过 Socket.IO `task-updated` 广播，前端任务中心和相关业务页面共用该事件。

### [已实现] 获取任务详情
- **用途**：获取单个任务的状态和结果。
- **请求方法**：`GET`
- **路径**：`/api/tasks/:taskId`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "id": "task_xxx",
      "type": "download_zip",
      "eventId": "evt_xxx",
      "title": "生成批量下载 ZIP",
      "status": "running",
      "total": 10,
      "finished": 4,
      "successCount": 4,
      "failedCount": 0,
      "skippedCount": 0,
      "errors": [],
      "result": null,
      "startedAt": "2026-05-15T10:00:00.000Z",
      "elapsedMs": 1000,
      "estimatedRemainingMs": 1500,
      "currentFileName": "DSC_0001.JPG",
      "createdAt": "2026-05-15T10:00:00.000Z",
      "updatedAt": "2026-05-15T10:00:01.000Z",
      "finishedAt": ""
    },
    "error": null
  }
  ```

### [已实现] 取消任务
- **用途**：请求取消任务。当前主要用于正在运行的导入类任务、客户端上传处理和已修图回传处理；任务收到取消请求后停止处理新文件，正在处理的单个文件允许完成，已完成结果不回滚。
- **请求方法**：`POST`
- **路径**：`/api/tasks/:taskId/cancel`
- **请求参数示例**：无
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "id": "task_xxx",
      "status": "cancelled",
      "finishedAt": "2026-05-19T10:10:00.000Z"
    },
    "error": null
  }
  ```
- **错误码**：
  - `TASK_NOT_FOUND`：任务不存在。
- **备注**：不是所有历史任务都能中途停止；导入和已修图回传等处理类任务会在批次循环中检查取消状态。

---

## 六、Upload 客户端上传

### [已实现] 客户端上传 JPG/JPEG/PNG
- **用途**：客户端通过局域网上传一个或多个 JPG/JPEG/PNG 文件到主机当前活动，并创建后台处理任务生成缩略图、预览图和数据库记录。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/upload`
- **请求类型**：`multipart/form-data`
- **字段**：
  - `files`：一个或多个 JPG/JPEG/PNG 文件。
  - `photographer`：摄影师，可选。
  - `device`：设备名，可选。
  - `remark`：备注，可选。
  - `clientId`：客户端持久 ID，可选；由客户端 localStorage 生成并保存。
  - `clientName`：客户端设备名称，可选；为空时后端按“客户端”兜底。
  - `clientRole`：轻量来源角色，当前固定为 `client`。
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "taskId": "task_xxx",
      "total": 3,
      "photographer": "张三",
      "device": "修图电脑A",
      "remark": "外拍上传",
      "clientId": "7f0f0a52-1111-4a2a-8888-123456789abc",
      "clientName": "修图电脑A",
      "clientRole": "client"
    },
    "error": null
  }
  ```
- **错误码**：
  - `INVALID_MULTIPART_REQUEST`：请求不是有效的 multipart 上传请求。
  - `UPLOAD_TOO_LARGE`：上传内容超过限制。
  - `TOO_MANY_FILES`：一次上传文件数量超过限制。
  - `NO_UPLOAD_FILES`：没有收到 `files` 文件。
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_IMPORTABLE`：活动已归档或删除，不能上传。
  - `MISSING_IMAGE_PROCESSOR`：缺少 `sharp` 依赖。
- **备注**：
  - 当前接受 `.jpg` / `.jpeg` / `.png`，并校验 `image/jpeg` / `image/png` MIME；不接受 RAW、HEIC、TIFF、GIF、WebP 原图或视频。
  - 后端会先将上传文件写入系统临时目录，创建后台任务后处理图片；任务结束后清理临时文件。
  - 原图复制到 `working/{event_slug}/原图/客户端上传`，不移动、不删除客户端源文件。
  - 缩略图和预览图仍写入活动的 `缩略图`、`预览图` 目录。
  - 使用 sha256 `file_hash` 在同一活动内去重，当前活动已有相同图片时计入 `skipped`。
  - v0.17.0 开发阶段 17.1 起，客户端上传成功入库的图片会写入 `images.uploaded_by_client_id`、`uploaded_by_name`、`uploaded_by_role`、`uploaded_at`，用于主机端来源展示和上传者筛选。
  - v0.16.0 开发阶段 16.4 起，客户端上传页支持拖拽单张或多张 JPG/JPEG/PNG 图片，拖拽入口仍使用本 multipart 接口；客户端拖拽文件夹暂不支持。
  - 每张图片成功入库后广播 `image-created`；整体进度通过 `GET /api/tasks/:taskId` 和 `task-updated` 查看。

---

## 七、Download 下载

### [已实现] 下载原图
- **用途**：获取未处理的原始大图。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/download/original`
- **请求参数示例**：无
- **响应示例**：返回原图文件流，并带 `Content-Disposition` 下载头。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片记录不存在。
  - `IMAGE_FILE_NOT_FOUND`：原图文件不存在。
- **备注**：后端按 `image.id` 查询 `original_path` 后下载，不暴露仓库目录。下载成功后写入 `download_logs` 和 `operation_logs`。

### [已实现] 下载预览图
- **用途**：获取长边 1600px 的 WebP 预览大图。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/download/preview`
- **请求参数示例**：无
- **响应示例**：返回 WebP 文件流，并带 `Content-Disposition` 下载头。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片记录不存在。
  - `IMAGE_FILE_NOT_FOUND`：预览图文件不存在。
- **备注**：后端按 `image.id` 查询 `preview_path` 后下载，不暴露仓库目录。下载成功后写入 `download_logs` 和 `operation_logs`。

### [已实现] 下载已修图
- **用途**：获取修片回传的最终 JPG。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/download/edited`
- **请求参数示例**：无
- **响应示例**：返回已修图文件流，并带 `Content-Disposition` 下载头。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片记录不存在。
  - `EDITED_IMAGE_NOT_AVAILABLE`：`edited_path` 为空，暂无已修图。
  - `IMAGE_FILE_NOT_FOUND`：已修图文件不存在。
- **备注**：后端按 `image.id` 查询 `edited_path` 后下载，不暴露仓库目录。下载成功后写入 `download_logs` 和 `operation_logs`。

### [已实现] 生成 ZIP 下载包
- **用途**：将选中的多张图打包成 ZIP 下载。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/download/zip`
- **请求参数示例**：
  ```json
  {
    "imageIds": ["img_1", "img_2"],
    "type": "best",
    "filenameMode": "sequence"
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "taskId": "task_xxx"
    },
    "error": null
  }
  ```
- **type 支持**：
  - `original`：原图。
  - `preview`：预览图。
  - `edited`：已修图。
  - `best`：优先已修图，缺失时回退原图。
- **filenameMode 支持**：
  - `sequence`：按顺序加 `001_` 前缀。
  - `original`：尽量保留原文件名。
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_DOWNLOADABLE`：活动不可下载。
  - `NO_DOWNLOAD_IMAGES`：没有选择图片。
  - `INVALID_DOWNLOAD_ZIP_TYPE`：下载类型无效。
  - `INVALID_FILENAME_MODE`：文件命名方式无效。
- **备注**：必须走任务系统。ZIP 写入 `working/{event_slug}/导出/压缩包`，缺失文件进入任务 `errors`，任务完成后 `result.downloadUrl` 可用于下载。

### [已实现] 下载批量 ZIP 包
- **用途**：下载已经生成的批量 ZIP。
- **请求方法**：`GET`
- **路径**：`/api/download-packages/:packageId/download`
- **请求参数示例**：无
- **响应示例**：返回 ZIP 文件流，并带 `Content-Disposition` 下载头。
- **错误码**：
  - `DOWNLOAD_PACKAGE_NOT_FOUND`：下载包不存在或服务已重启。
  - `DOWNLOAD_PACKAGE_FILE_NOT_FOUND`：ZIP 文件不存在。
- **备注**：下载成功写入 `download_logs.type = zip` 和 `operation_logs.type = download_zip_downloaded`。

---

## 八、Edit Workflow 修图流转

### [已实现] 生成待修包
- **用途**：将状态为 edit 的图片原图及 manifest 打包，支持全部单包、按数量平均拆包和自定义分包。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/edit-package`
- **请求参数示例**：
  平均拆包：
  ```json
  {
    "splitMode": "count",
    "packageCount": 3
  }
  ```
  自定义分包：
  ```json
  {
    "splitMode": "custom",
    "packages": [
      {
        "name": "领导特写",
        "imageIds": ["img_1", "img_2", "img_3"]
      },
      {
        "name": "舞台全景",
        "imageIds": ["img_4", "img_5"]
      }
    ]
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "eventId": "evt_xxx",
      "splitMode": "custom",
      "packageCount": 3,
      "packages": [
        {
          "packageId": "pkg_xxx",
          "name": "领导特写",
          "packageIndex": 1,
          "packageTotal": 3,
          "packagePath": "E:\\MediaPhotoWorkspace\\working\\event\\导出\\压缩包\\待修包_领导特写_20260515_120000_第1包_共3包_pkg_xxx.zip",
          "downloadUrl": "http://localhost:3030/api/edit-packages/pkg_xxx/download",
          "total": 4,
          "success": 4,
          "skipped": 0,
          "status": "success",
          "createdAt": "2026-05-15 12:00:00",
          "errors": []
        }
      ],
      "total": 12,
      "success": 12,
      "skipped": 0,
      "errors": [
        {
          "imageId": "img_xxx",
          "filename": "IMG_0001.JPG",
          "reason": "原图文件不存在，已跳过"
        }
      ],
      "warnings": [
        {
          "type": "duplicatedImageIds",
          "imageIds": ["img_1"],
          "reason": "部分图片被分配到多个待修包，已按请求继续生成"
        }
      ]
    },
    "error": null
  }
  ```
- **ZIP 内容**：
  ```text
  edit_manifest.json
  待修原图/IMG_0001.JPG
  待修原图/IMG_0002.PNG
  已修图回传/edit_manifest.json
  已修图回传/请把修好的JPG放在这里.txt
  ```
- **edit_manifest.json 示例**：
  ```json
  [
    {
      "package_id": "pkg_xxx",
      "package_name": "领导特写",
      "package_index": 1,
      "package_total": 3,
      "image_id": "img_xxx",
      "event_id": "evt_xxx",
      "original_filename": "IMG_0001.JPG",
      "export_filename": "IMG_0001.JPG",
      "stored_filename": "event_20260514_img_xxx_IMG_0001.JPG",
      "file_hash": "sha256...",
      "original_path": "E:\\MediaPhotoWorkspace\\working\\event\\原图\\主机导入\\..."
    }
  ]
  ```
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_EDITABLE`：活动已归档或删除，不能执行修图流转。
  - `NO_EDIT_IMAGES`：没有 `status = edit` 的待修图。
  - `EMPTY_CUSTOM_PACKAGES`：自定义分包模式没有提供包列表。
  - `INVALID_PACKAGE_NAME`：自定义包名称为空。
  - `EMPTY_PACKAGE_IMAGES`：自定义包没有选择图片。
- **备注**：
  - `splitMode = count` 时，`packageCount` 默认 `1`，最小 `1`，最大 `20`；前端默认用 `packageCount = 1` 生成一个完整待修包。
  - 当 `packageCount > 1` 时，系统将待修图平均分配到多个独立 ZIP；如果待修图数量少于请求包数，不生成空包。
  - `splitMode = custom` 时，后端按 `packages[].imageIds` 逐包生成 ZIP；不存在、跨活动、已删除或非 `status = edit` 的图片进入 `errors` 或 `skipped`。
  - 同一张图片被放入多个自定义包时第一版允许继续生成，并在 `warnings` 中返回 `duplicatedImageIds`。
  - 非自定义模式只查询 `status = edit` 且 `is_deleted = 0` 的图片。
  - 原图缺失的图片会跳过并写入 `errors`。
  - 待修包保存到 `working/{event_slug}/导出/压缩包`。
  - 待修包 ZIP 文件名使用中文前缀 `待修包_...zip`；自定义包会把安全化后的包名写入 ZIP 文件名。
  - 待修包会保留原图扩展名；如果待修原图是 PNG，ZIP 内也会放入 PNG 原图。
  - ZIP 内预置 `已修图回传` 文件夹，文件夹内包含一份同内容的 `edit_manifest.json`，修图人员可把修好的 JPG/JPEG 放入该目录后直接拖入整个文件夹回传。
  - ZIP 不额外生成逐图标记文件；图片对应关系以 `edit_manifest.json` 为准，缺失 manifest 时只做文件名兜底。
  - 当前同步生成 ZIP，后续大批量活动应改为任务队列。

### [已实现] 获取活动待修包列表
- **用途**：读取当前活动已经生成的待修包，供主机和客户端修图任务页展示。
- **请求方法**：`GET`
- **路径**：`/api/events/:eventId/edit-packages`
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": [
      {
        "packageId": "pkg_xxx",
        "name": "领导特写",
        "packageIndex": 1,
        "packageTotal": 3,
        "total": 4,
        "success": 4,
        "skipped": 0,
        "status": "success",
        "packagePath": "E:\\MediaPhotoWorkspace\\working\\event\\导出\\压缩包\\待修包_领导特写_...",
        "downloadUrl": "http://localhost:3030/api/edit-packages/pkg_xxx/download",
        "createdAt": "2026-05-15 12:00:00",
        "updatedAt": "2026-05-15 12:00:00"
      }
    ],
    "error": null
  }
  ```
- **备注**：待修包列表复用 `export_jobs`，记录使用 `type = edit_package`，包名与拆包序号写入 `spec.package_name`、`spec.package_index` 和 `spec.package_total`。旧记录没有 `package_name` 时前端显示“第 x / y 包”或“待修包”。

### [已实现] 下载待修包
- **用途**：下载已经生成的待修包 ZIP。
- **请求方法**：`GET`
- **路径**：`/api/edit-packages/:packageId/download`
- **请求参数示例**：无
- **响应示例**：返回 ZIP 文件流，并带 `Content-Disposition` 下载头。
- **错误码**：
  - `EDIT_PACKAGE_NOT_FOUND`：待修包记录不存在。
  - `EDIT_PACKAGE_FILE_NOT_FOUND`：待修包 ZIP 文件不存在。
- **备注**：待修包记录复用 `export_jobs`，`type = edit_package`。下载成功后写入 `download_logs.type = zip` 和 `operation_logs.type = edit_package_downloaded`。

### [已实现] 删除待修包
- **用途**：主机端删除已经生成的待修包 ZIP 和对应记录，不影响待修图片、原图或已修图。
- **请求方法**：`DELETE`
- **路径**：`/api/edit-packages/:packageId`
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "packageId": "pkg_xxx",
      "eventId": "evt_xxx",
      "deletedFiles": [
        "E:\\MediaPhotoWorkspace\\working\\event\\导出\\压缩包\\待修包_领导特写_20260515_120000_pkg_xxx.zip"
      ],
      "missingFiles": [],
      "deletedRecords": {
        "exportJobs": 1
      }
    },
    "error": null
  }
  ```
- **错误码**：
  - `EDIT_PACKAGE_NOT_FOUND`：待修包记录不存在。
  - `EDIT_PACKAGE_DELETE_FILE_FAILED`：待修包 ZIP 文件被占用或删除失败。
- **备注**：删除成功写入 `operation_logs.type = edit_package_deleted`。客户端页面不提供删除入口。

### [已实现] 批量回传已修图
- **用途**：修片师将修好的 JPG/JPEG 成片连同 manifest 一起上传，并创建后台回传处理任务。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/edited/upload`
- **请求类型**：`multipart/form-data`
- **字段**：
  - `manifest`：`edit_manifest.json`，可选。
  - `files`：一个或多个 JPG/JPEG 已修图文件。
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "taskId": "task_xxx",
      "total": 3,
      "mode": "edited_upload"
    },
    "error": null
  }
  ```
- **任务结果示例**：任务完成后可通过 `GET /api/tasks/:taskId` 或 Socket.IO `task-updated` 获取：
  ```json
  {
    "id": "task_xxx",
    "type": "edited_upload",
    "status": "success",
    "total": 3,
    "finished": 3,
    "successCount": 2,
    "failedCount": 1,
    "skippedCount": 1,
    "result": {
      "total": 3,
      "matched": 2,
      "unmatched": 1,
      "errors": [
        {
          "filename": "unknown_final.jpg",
          "reason": "未能匹配到原图"
        }
      ],
      "items": [
        {
          "imageId": "img_xxx",
          "originalFilename": "IMG_0001.JPG",
          "uploadedFilename": "IMG_0001_final.jpg",
          "editedPath": "E:\\MediaPhotoWorkspace\\working\\event\\已修图\\...",
          "matchedBy": "filename",
          "status": "edited"
        }
      ]
    }
  }
  ```
- **匹配规则**：
  - 优先读取 `edit_manifest.json`，按上传文件名匹配 manifest 中的 `export_filename` / `original_filename`，再取 `image_id` 更新对应图片。
  - manifest 缺失或未匹配时，按活动内图片 `original_filename` 兜底匹配。
  - 文件名兜底会去除 `_edit`、`-edit`、`_已修`、`-已修`、`_final`、`-final` 等常见后缀后比较。
  - 完全无关的任意改名无法可靠自动匹配；这种情况必须同时上传 `edit_manifest.json`，或保留原文件名主体。
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_EDITABLE`：活动已归档或删除，不能执行修图流转。
  - `NO_EDITED_FILES`：没有收到 JPG/JPEG 已修图文件。
  - `INVALID_EDIT_MANIFEST`：`edit_manifest.json` 解析失败。
- **备注**：
  - 当前已修图回传仍只支持 JPG/JPEG；即使待修原图为 PNG，也请回传 JPG/JPEG 成片。
  - 前端回传页支持拖拽 `已修图回传` 文件夹，并会递归读取其中的 JPG/JPEG 和 `edit_manifest.json`；API 本身仍使用 `multipart/form-data`。
  - v0.16.0 开发阶段起，该接口返回 `taskId`，主机端和客户端回传页会监听 `task-updated` 显示处理进度、匹配成功 / 未匹配数量和错误列表。
  - 已修图保存到 `working/{event_slug}/已修图`，不覆盖原图。
  - 同一张图片重复回传时，会删除该图片旧的已修图文件并保存最新版本，避免 `已修图` 目录产生重复副本。
  - 成功回传后会用最新已修图重新生成该图片的 `缩略图` 和 `预览图` WebP，因此图片墙和预览弹窗显示最新已修版本。
  - 成功匹配后更新 `images.edited_path`、`images.status = edited`、`images.updated_at`。
  - 成功匹配后写入 `operation_logs.type = edited_image_uploaded`，并广播 `image-updated`。

### [计划中] 获取回传匹配结果
- **用途**：查看已修图通过 manifest 匹配原图的成功与失败记录。
- **请求方法**：`GET`
- **路径**：`/api/events/:eventId/edit-matches`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

---

## 九、Export 导出发布

### [已实现] 触发发布导出
- **用途**：将满足发布条件的图片，按配置规格导出到 `导出/发布图` 目录，并生成发布 ZIP。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/export`
- **请求参数示例**：
  ```json
  {
    "mode": "selected",
    "imageIds": ["img_1", "img_2"],
    "size": "3000px",
    "quality": 90,
    "filenameMode": "sequence",
    "limitFileSize10Mb": false
  }
  ```
- **字段说明**：
  - `mode`：`selected | publish | edited | rating`。
  - `imageIds`：当 `mode = selected` 时使用。
  - `ratingMin`：当 `mode = rating` 时使用，第一版默认 4。
  - `size`：`original | 3000px | 1920px`。
  - `quality`：JPEG 质量，1-100，默认建议 90。
  - `filenameMode`：`sequence | original | event_original`。
  - `limitFileSize10Mb`：可选布尔值，默认 `false`。开启后，单张导出 JPG 必须小于等于 10MB；未超过 10MB 的原尺寸 JPEG 源文件会直接复制，不再重压缩。
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "jobId": "export_xxx",
      "eventId": "evt_xxx",
      "mode": "publish",
      "size": "3000px",
      "quality": 90,
      "filenameMode": "sequence",
      "limitFileSize10Mb": false,
      "status": "success",
      "total": 10,
      "success": 9,
      "failed": 1,
      "outputDir": "E:\\MediaPhotoWorkspace\\working\\event\\导出\\发布图\\20260514_150000",
      "zipPath": "E:\\MediaPhotoWorkspace\\working\\event\\导出\\压缩包\\publish_event_20260514_150000_export_xxx.zip",
      "downloadUrl": "http://localhost:3030/api/exports/export_xxx/download",
      "errors": [
        {
          "imageId": "img_missing",
          "filename": "IMG_0001.JPG",
          "reason": "原图和已修图都不存在，已跳过"
        }
      ],
      "createdAt": "2026-05-14 15:00:00",
      "updatedAt": "2026-05-14 15:00:02"
    },
    "error": null
  }
  ```
- **导出规则**：
  - 优先导出存在的 `edited_path`。
  - 没有已修图时导出 `original_path`。
  - `edited_path` 和 `original_path` 都不存在时跳过并写入 `errors`。
  - `original` 规格不缩放；`3000px` 和 `1920px` 使用 `sharp` 转为 JPEG。
  - 发布导出统一生成 JPG 发布图；PNG 原图不会被改写，原图下载、批量原图 ZIP 和待修包仍保留 PNG 原文件，发布导出时由 `sharp` 转为 JPEG；透明 PNG 会以白色背景合成。
  - JPEG 质量只控制编码质量，不再和 10MB 限制强关联。
  - 当 `limitFileSize10Mb = true` 且导出文件超过 10MB 时，系统会自动继续降低 JPEG 质量；如果仍超过 10MB，会进一步缩小长边，直到满足 10MB 限制。
  - 10MB 限制是独立上限保护，不是强制压缩；原尺寸导出时 JPEG 源文件已小于等于 10MB 会保持原文件画质。
  - 每次导出生成独立目录 `working/{event_slug}/导出/发布图/{timestamp}`。
  - ZIP 保存到 `working/{event_slug}/导出/压缩包`。
  - 导出成功写入 `export_jobs.type = publish`。
  - 导出开始、单图导出、导出完成或失败均写入 `operation_logs`。
  - 导出完成后广播 `export-created`。
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
  - `EVENT_NOT_EXPORTABLE`：活动已归档或删除，不能导出。
  - `INVALID_EXPORT_MODE`：导出来源非法。
  - `INVALID_EXPORT_SIZE`：导出规格非法。
  - `INVALID_EXPORT_QUALITY`：JPEG 质量不是 1-100 的整数。
  - `NO_EXPORT_IMAGES`：当前条件下没有可导出的图片。
- **备注**：
  - 当前环境安装 `archiver` 受网络限制失败，发布 ZIP 暂复用项目内 ZIP 工具；接口和输出结构保持一致，后续可替换为 `archiver`。

### [已实现] 获取导出任务状态
- **用途**：查询发布导出任务结果。
- **请求方法**：`GET`
- **路径**：`/api/exports/:jobId`
- **请求参数示例**：无
- **响应示例**：同发布导出响应中的 `data`。
- **错误码**：
  - `EXPORT_JOB_NOT_FOUND`：导出任务不存在。

### [已实现] 下载发布包
- **用途**：下载已经成功导出的压缩包。
- **请求方法**：`GET`
- **路径**：`/api/exports/:jobId/download`
- **请求参数示例**：无
- **响应示例**：返回文件流
- **错误码**：
  - `EXPORT_JOB_NOT_FOUND`：导出任务不存在。
  - `EXPORT_FILE_NOT_FOUND`：导出 ZIP 文件不存在。
- **备注**：下载成功后写入 `download_logs.type = export` 和 `operation_logs.type = publish_export_downloaded`。

---

## 十、Archive 活动归档

### [已实现] 准备归档
- **用途**：生成独立的归档目录及 `event.db`。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/prepare`
- **请求参数示例**：无
- **响应示例**：返回 `archivePath`、图片数量、缩略图复制数量、缺失文件、`manifestPath` 和 `eventDbPath`。
- **备注**：归档目录位于 `archive/{event_slug}`；如果目录已存在，会使用时间后缀避免覆盖。当前轻量归档只保留缩略图和 metadata。

### [已实现] 验证归档完整性
- **用途**：比对文件数量、hash，确保没有漏归档。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/verify`
- **请求参数示例**：无
- **响应示例**：返回 `verified`、`missingFiles` 和 `mismatchedFiles`。
- **备注**：读取 `metadata/manifest.json` 验证归档文件。

### [已实现] 清理工作区
- **用途**：用户确认归档无误后，安全删除 working 目录下的原活动文件。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/cleanup`
- **请求参数示例**：
  ```json
  {
    "confirm": true,
    "archivePath": "E:\\MediaPhotoWorkspace\\archive\\event_slug"
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "taskId": "task_xxx",
      "total": 0,
      "mode": "archive_cleanup"
    },
    "error": null
  }
  ```
- **任务结果**：清理完成后通过 `task-updated` 推送最终结果，`result` 中包含 `eventId`、`workingDir`、`archivePath`、`cleaned` 和 `archivedEvent`。
- **备注**：只有归档验证通过后才能清理。清理工作区会创建后台任务，任务中心显示删除进度、已用时间和预计剩余时间，避免多图活动删除 `working` 目录时前端请求长时间卡住。第一版保留主库图片详细记录，活动状态改为 `archived`，并写入 `archived_events` 摘要。

### [已实现] 读取历史归档数据
- **用途**：打开只读的历史归档页面。
- **请求方法**：`GET`
- **路径**：`/api/archived-events/:id`
- **请求参数示例**：无
- **响应示例**：返回归档摘要、manifest 计数、metadata 文件状态、缺失文件和 images.csv 图片元数据。
- **备注**：working 工作区已清理时仍可读取；只读接口不修改任何归档或业务数据。

---

## 十一、Realtime 实时事件

### [已实现] Socket.IO 连接
- **用途**：让同一主机服务下的多个页面或后续客户端实时感知图片变化。
- **连接地址**：复用当前后端地址和端口，例如 `http://localhost:3030`。
- **端口规则**：Socket.IO 挂载在 Express HTTP server 上，不单独占用端口；后端如果因冲突切换到 3031-3040，Socket.IO 同步使用实际端口。
- **连接成功事件**：服务端会向当前客户端发送 `realtime-status`。

连接状态 payload 示例：

```json
{
  "ok": true,
  "socketId": "xxx",
  "connected": true,
  "connectedAt": "2026-05-14T01:20:00.000Z"
}
```

### [已实现] 图片实时事件

客户端（通过局域网或本机）通过 Socket.IO 连接到主机，可监听以下事件：

- `image-created`：主机本地导入或客户端上传成功后广播。
- `image-updated`：图片星级、状态、分类或备注更新后广播。
- `image-deleted-logical`：图片逻辑删除后广播。
- `clients-updated`：在线客户端列表更新后广播，主机自身不计入列表。
- `task-updated`：任务状态变化后广播，当前已接入主机导入、客户端上传处理、批量 ZIP 下载、待修包生成、已修图回传、发布导出、活动归档 prepare 和归档 cleanup；主机导入页、客户端上传页、已修图回传页和任务中心共用该事件更新进度与最终统计。
- `export-created`：发布导出完成后广播，当前前端暂未消费该事件。

客户端可通过 `client-register` 或 `client-hello` 上报在线身份：

```json
{
  "clientId": "7f0f0a52-1111-4a2a-8888-123456789abc",
  "clientName": "修图电脑A",
  "role": "client"
}
```

`clients-updated` payload 示例：

```json
{
  "clients": [
    {
      "clientId": "7f0f0a52-1111-4a2a-8888-123456789abc",
      "clientName": "修图电脑A",
      "role": "client",
      "connectedAt": "2026-05-22T08:20:00.000Z",
      "lastSeenAt": "2026-05-22T08:21:00.000Z",
      "userAgent": "Mozilla/5.0 ...",
      "address": "::ffff:192.168.1.24"
    }
  ]
}
```

图片事件 payload 示例：

```json
{
  "eventId": "evt_xxx",
  "imageId": "img_xxx",
  "action": "rating_changed",
  "actor": {
    "type": "client",
    "id": "7f0f0a52-1111-4a2a-8888-123456789abc",
    "name": "修图电脑A"
  },
  "updatedAt": "2026-05-14T01:20:00.000Z",
  "image": {
    "id": "img_xxx",
    "event_id": "evt_xxx",
    "original_filename": "DSC_0001.jpg",
    "thumb_url": "http://localhost:3030/api/images/img_xxx/thumb",
    "preview_url": "http://localhost:3030/api/images/img_xxx/preview",
    "rating": 4,
    "status": "unselected",
    "category": "",
    "remark": ""
  }
}
```

任务事件 payload 示例：

```json
{
  "taskId": "task_xxx",
  "type": "host_import",
  "eventId": "evt_xxx",
  "status": "running",
  "total": 4000,
  "finished": 1200,
  "successCount": 1180,
  "failedCount": 5,
  "skippedCount": 15,
  "errors": [],
  "result": null,
  "startedAt": "2026-05-19T10:00:00.000Z",
  "elapsedMs": 180000,
  "estimatedRemainingMs": 420000,
  "currentFileName": "DSC_1200.JPG",
  "updatedAt": "2026-05-19T10:03:00.000Z"
}
```

### [计划中] 后续实时事件

- `archive-updated`：活动的归档状态发生变动。
