# Media Photo Workbench / 融媒体图片工作台 - API 规范

## 当前阶段说明

当前开发阶段为 **v0.13.0-dev：Windows 打包发布**。

本阶段不新增业务 API，但调整生产模式访问方式：打包后 Express 托管前端 `dist/`，前端页面、`/api` 接口和 Socket.IO 复用同一个后端端口。开发模式仍使用 Vite `5173` 访问前端、`3030-3040` 访问后端 API。

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

### 统一响应格式

**成功：**
```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

**失败：**
```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误说明"
  }
}
```

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
      "database": { "status": "connected" },
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
- **备注**：前端启动、客户端连接和主机系统概览页会调用该接口。`server.port` 是本次真实监听端口，`server.configuredPort` 是配置中的首选端口。`network.lanAddresses` 来自当前主机 Wi-Fi / WLAN / 以太网 IPv4 网卡，已过滤 VMware、Docker、WSL、Hyper-V 等虚拟网卡。容量读取失败时 `freeSpace` / `totalSpace` 可能为 `null`，前端应显示“暂不可用”而不是假容量。

---

## 二、Settings 设置

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
      "database": { "path": "D:\\project\\Image Workspace\\data\\app.db" }
    },
    "error": null
  }
  ```
- **备注**：无

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

---

## 三、Events 活动管理

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
- **备注**：该接口只修改活动状态，不移动或删除工作区文件。

### [已实现] 逻辑删除活动
- **用途**：把活动标记为已删除，使其不再出现在默认活动列表中。
- **请求方法**：`DELETE`
- **路径**：`/api/events/:id`
- **请求参数示例**：无
- **响应示例**：返回状态为 `deleted` 的活动对象。
- **错误码**：
  - `EVENT_NOT_FOUND`：活动不存在。
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
- **备注**：图片仍通过 `event_id` 归属该活动，恢复时不移动图片文件。

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
  - `EVENT_PURGE_FILE_FAILED`：工作区文件删除失败。
- **备注**：仅允许对 `status = deleted` 的活动执行。前端必须二次确认并建议输入活动名称。默认删除 `working/{event_slug}` 和对应 `archive/{event_slug}` / `archive/{event_slug}_*` 归档目录；如明确传 `includeArchive = false` 才保留归档目录。数据库会清理该活动的 `images`、`image_tags`、`download_logs`、`export_jobs`、`operation_logs`、`archived_events` 和 `events` 相关记录。

### [已实现] 准备活动归档
- **用途**：执行活动归档准备流程。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/prepare`
- **请求参数示例**：无
- **响应示例**：返回归档目录、缩略图复制数量、缺失文件、`manifestPath` 和 `eventDbPath`。
- **备注**：生成轻量归档 `archive/{event_slug}`，只复制缩略图到 `缩略图/`，并生成 `metadata/manifest.json`、`images.csv`、`operation_logs.csv` 和独立 `event.db`；原图、已修图、发布图和压缩包只记录历史路径，不复制进归档。

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

---

## 四、Images 图片管理

### [已实现] 获取活动下的图片列表
- **用途**：获取某活动下的图片库，支持筛选和分页。
- **请求方法**：`GET`
- **路径**：`/api/events/:eventId/images`
- **查询参数**：
  - `page`：页码，默认 `1`。
  - `pageSize`：每页数量，默认 `80`，最大 `200`。
  - `rating`：最低星级，例如 `4` 表示查询星级大于等于 4 的图片。
  - `status`：图片状态，支持 `unselected | rejected | archive | edit | edited | publish | published`。
  - `source_type`：图片来源，常用 `host_import` 或 `client_upload`。
  - `keyword`：关键字，匹配文件名、分类、备注、摄影师、相机和镜头字段。
- **请求参数示例**：`?page=1&pageSize=80&rating=4&status=publish&source_type=host_import&keyword=现场`
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
- **备注**：当前未实现标签筛选；默认只返回 `is_deleted = 0` 的图片。缩略图和预览图使用 `thumb_url` / `preview_url` 访问，原图、预览图下载和已修图下载使用 Download 下载接口。

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
  { "rating": 5 }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
  - `INVALID_RATING`：`rating` 不是 0-5 的整数。
- **备注**：更新 `images.updated_at`，并写入 `operation_logs`。

### [已实现] 修改图片状态
- **用途**：修改图片流转状态 (unselected, rejected, edit, publish 等)。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/status`
- **请求参数示例**：
  ```json
  { "status": "publish" }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
  - `INVALID_STATUS`：状态不在允许范围内。
- **备注**：允许状态为 `unselected | rejected | archive | edit | edited | publish | published`。更新 `images.updated_at`，并写入 `operation_logs`。

### [已实现] 修改图片分类
- **用途**：更改图片的主分类。
- **请求方法**：`PATCH`
- **路径**：`/api/images/:id/category`
- **请求参数示例**：
  ```json
  { "category": "现场特写" }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
- **备注**：分类会 trim 后保存；允许保存为空字符串。更新 `images.updated_at`，并写入 `operation_logs`。

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
  { "remark": "注意提亮暗部" }
  ```
- **响应示例**：返回更新后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
- **备注**：备注会 trim 后保存；允许保存为空字符串。更新 `images.updated_at`，并写入 `operation_logs`。

### [已实现] 逻辑删除图片
- **用途**：将图片从图片墙移除，但不删除仓库中的任何物理文件。
- **请求方法**：`DELETE`
- **路径**：`/api/images/:id`
- **请求参数示例**：无
- **响应示例**：返回 `is_deleted = true` 的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
- **备注**：该接口只写入 `images.is_deleted = 1` 和 `deleted_at`，并写入 `operation_logs.type = image_deleted_logical`。默认图片查询不会再返回已逻辑删除图片。

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
- **请求参数示例**：无
- **响应示例**：返回恢复后的图片对象。
- **错误码**：
  - `IMAGE_NOT_FOUND`：图片不存在。
  - `IMAGE_NOT_DELETED`：图片不在回收站中。
- **备注**：恢复会写入 `operation_logs.type = image_restored`，并广播 `image-updated`。

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

## 五、Import 图片导入

### [已实现] 扫描待导入目录
- **用途**：扫描主机本地目录，返回可导入的 JPG/JPEG 文件数量、总大小和文件列表摘要。
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
- **备注**：第一版只扫描当前文件夹第一层，不递归子目录。只识别 `.jpg` / `.jpeg`。

### [已实现] 开始导入任务
- **用途**：同步导入主机本地 JPG/JPEG 文件，复制原图、生成缩略图和预览图、读取 EXIF、写入数据库。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/import/start`
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
      "sourceType": "host_import",
      "total": 2,
      "success": 1,
      "failed": 0,
      "skipped": 1,
      "imported": [
        {
          "id": "img_xxx",
          "originalFilename": "IMG_0001.JPG",
          "storedFilename": "event_20260513_190000_img_xxx_IMG_0001.JPG",
          "originalPath": "E:\\MediaPhotoWorkspace\\working\\event\\原图\\主机导入\\...",
          "thumbPath": "E:\\MediaPhotoWorkspace\\working\\event\\缩略图\\img_xxx.webp",
          "previewPath": "E:\\MediaPhotoWorkspace\\working\\event\\预览图\\img_xxx.webp"
        }
      ],
      "errors": []
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
  - `REPOSITORY_NOT_READY`：仓库路径未配置、不存在、不可读或不可写。
  - `MISSING_IMAGE_PROCESSOR`：缺少 `sharp` 依赖。
- **备注**：
  - 第一版同步执行，不返回 `taskId`。
  - 不移动、不删除、不覆盖源文件。
  - 原图复制到 `working/{event_slug}/原图/主机导入`。
  - 缩略图写入 `working/{event_slug}/缩略图/{imageId}.webp`，长边 400px。
  - 预览图写入 `working/{event_slug}/预览图/{imageId}.webp`，长边 1600px。
  - 通过 sha256 `file_hash` 在同一活动内去重，当前活动已有相同图片时计入 `skipped`。
  - EXIF 读取失败不会导致导入失败。

### [已实现] 获取任务列表
- **用途**：获取当前运行期内的任务列表。
- **请求方法**：`GET`
- **路径**：`/api/tasks`
- **请求参数示例**：无
- **响应示例**：返回任务数组，按创建时间倒序。
- **备注**：v0.10.0-dev 第一版任务系统使用内存存储，应用重启后任务记录会清空。

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
      "createdAt": "2026-05-15T10:00:00.000Z",
      "updatedAt": "2026-05-15T10:00:01.000Z",
      "finishedAt": ""
    },
    "error": null
  }
  ```

### [已实现] 取消任务占位
- **用途**：取消任务。
- **请求方法**：`POST`
- **路径**：`/api/tasks/:taskId/cancel`
- **请求参数示例**：无
- **错误码**：
  - `TASK_CANCEL_NOT_SUPPORTED`：当前版本暂不支持真正取消。
- **备注**：第一版先显式返回错误，避免静默假取消。

---

## 六、Upload 客户端上传

### [已实现] 客户端上传 JPG/JPEG
- **用途**：客户端通过局域网上传一个或多个 JPG/JPEG 文件到主机当前活动。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/upload`
- **请求类型**：`multipart/form-data`
- **字段**：
  - `files`：一个或多个 JPG/JPEG 文件。
  - `photographer`：摄影师，可选。
  - `device`：设备名，可选。
  - `remark`：备注，可选。
- **响应示例**：
  ```json
  {
    "ok": true,
    "data": {
      "eventId": "evt_xxx",
      "folderPath": "",
      "sourceType": "client_upload",
      "photographer": "张三",
      "device": "Client-A",
      "remark": "外拍上传",
      "total": 3,
      "success": 2,
      "failed": 0,
      "skipped": 1,
      "imported": [
        {
          "id": "img_xxx",
          "originalFilename": "DSC_0001.JPG",
          "storedFilename": "event_20260514_120000_img_xxx_DSC_0001.JPG",
          "originalPath": "E:\\MediaPhotoWorkspace\\working\\event\\原图\\客户端上传\\...",
          "thumbPath": "E:\\MediaPhotoWorkspace\\working\\event\\缩略图\\img_xxx.webp",
          "previewPath": "E:\\MediaPhotoWorkspace\\working\\event\\预览图\\img_xxx.webp"
        }
      ],
      "errors": []
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
  - 第一版只接受 `.jpg` / `.jpeg`，不接受 RAW、HEIC、PNG 或视频。
  - 后端会先将上传文件写入系统临时目录，导入完成后清理临时文件。
  - 原图复制到 `working/{event_slug}/原图/客户端上传`，不移动、不删除客户端源文件。
  - 缩略图和预览图仍写入活动的 `缩略图`、`预览图` 目录。
  - 使用 sha256 `file_hash` 在同一活动内去重，当前活动已有相同图片时计入 `skipped`。
  - 上传成功后广播 `image-created`。

### [计划中] 获取上传任务状态
- **用途**：获取批量上传的整体统计。
- **请求方法**：`GET`
- **路径**：`/api/uploads/:taskId/status`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

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
  待修原图/IMG_0002.JPG
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
- **用途**：修片师将修好的 JPG 连同 manifest 一起上传。
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
    },
    "error": null
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
  - 前端回传页支持拖拽 `已修图回传` 文件夹，并会递归读取其中的 JPG/JPEG 和 `edit_manifest.json`；API 本身仍使用 `multipart/form-data`。
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
  - `limitFileSize10Mb`：可选布尔值，默认 `false`。开启后，单张导出 JPG 必须小于等于 10MB；未超过 10MB 的原尺寸源文件会直接复制，不再重压缩。
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
  - JPEG 质量只控制编码质量，不再和 10MB 限制强关联。
  - 当 `limitFileSize10Mb = true` 且导出文件超过 10MB 时，系统会自动继续降低 JPEG 质量；如果仍超过 10MB，会进一步缩小长边，直到满足 10MB 限制。
  - 10MB 限制是独立上限保护，不是强制压缩；原尺寸导出时源文件已小于等于 10MB 会保持原文件画质。
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
  { "confirm": true }
  ```
- **响应示例**：返回清理后的 `workingPath`、活动状态和归档摘要。
- **备注**：只有归档验证通过后才能清理。第一版保留主库图片详细记录，活动状态改为 `archived`，并写入 `archived_events` 摘要。

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
- `task-updated`：任务状态变化后广播，当前已接入批量 ZIP 下载、发布导出和活动归档 prepare。
- `export-created`：发布导出完成后广播，当前前端暂未消费该事件。

图片事件 payload 示例：

```json
{
  "eventId": "evt_xxx",
  "imageId": "img_xxx",
  "action": "rating_changed",
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

### [计划中] 后续实时事件

- `archive-updated`：活动的归档状态发生变动。
