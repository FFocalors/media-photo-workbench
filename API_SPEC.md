# Media Photo Workbench / 融媒体图片工作台 - API 规范

## 统一规范

所有 API 前缀统一为 `/api`。

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
      "status": "ok",
      "server": { "port": 3030 },
      "database": { "status": "connected" },
      "repository": { "exists": true, "readable": true, "writable": true, "path": "D:\\photos" }
    },
    "error": null
  }
  ```
- **备注**：前端启动或客户端连接时首次调用，判断能否正常工作。

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
      "freeSpace": null,
      "path": "D:\\photos"
    },
    "error": null
  }
  ```
- **备注**：当前实现只检查 `config/config.json` 中已保存的 `repository.path`。Windows 剩余空间暂返回 `null`。

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
      "freeSpace": null,
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

### [计划中] 获取活动回收站列表
- **用途**：查看已逻辑删除的活动，后续支持恢复或永久删除。
- **请求方法**：`GET`
- **路径**：`/api/events/trash`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：只返回 `status = deleted` 的活动。

### [计划中] 恢复已删除活动
- **用途**：将回收站中的活动恢复为可用状态。
- **请求方法**：`PATCH`
- **路径**：`/api/events/:id/restore`
- **请求参数示例**：
  ```json
  { "status": "active" }
  ```
- **响应示例**：略
- **备注**：图片仍通过 `event_id` 归属该活动，恢复时不需要移动图片文件。

### [计划中] 永久删除活动及工作区
- **用途**：彻底删除活动记录、图片记录和对应工作区文件。
- **请求方法**：`DELETE`
- **路径**：`/api/events/:id/purge`
- **请求参数示例**：
  ```json
  { "confirmName": "2026毕业典礼" }
  ```
- **响应示例**：略
- **备注**：仅允许对 `status = deleted` 的活动执行。必须二次确认，删除前应展示图片数量和工作区路径，失败时返回明确错误并记录日志。

### [计划中] 触发活动归档
- **用途**：执行活动归档流程。
- **请求方法**：`POST`
- **路径**：`/api/events/:id/archive`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

### [计划中] 获取已归档活动列表
- **用途**：获取历史已归档的只读活动列表摘要。
- **请求方法**：`GET`
- **路径**：`/api/archived-events`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

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
  - `source_type`：图片来源，第一版常用 `host_import`。
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
          "source_type": "host_import"
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
- **备注**：当前未实现标签筛选；图片 URL 只返回缩略图和预览图，不返回原图下载地址。

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
- **备注**：暂不实现原图下载接口。

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
  - 通过 sha256 `file_hash` 去重，重复图片计入 `skipped`。
  - EXIF 读取失败不会导致导入失败。

### [计划中] 获取任务进度
- **用途**：轮询获取长时间任务的进度。
- **请求方法**：`GET`
- **路径**：`/api/tasks/:taskId`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：用于前端进度条显示。

---

## 六、Upload 客户端上传

### [计划中] 客户端上传单图
- **用途**：客户端通过局域网上传图片（流式）。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/upload`
- **请求参数示例**：`multipart/form-data`
- **响应示例**：略
- **备注**：无

### [计划中] 获取上传任务状态
- **用途**：获取批量上传的整体统计。
- **请求方法**：`GET`
- **路径**：`/api/uploads/:taskId/status`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

---

## 七、Download 下载

### [计划中] 下载原图
- **用途**：获取未处理的原始大图。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/download/original`
- **请求参数示例**：无
- **响应示例**：返回文件流
- **备注**：无

### [计划中] 下载预览图
- **用途**：获取长边 1600px 的 WebP 预览大图。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/download/preview`
- **请求参数示例**：无
- **响应示例**：返回文件流
- **备注**：无

### [计划中] 下载已修图
- **用途**：获取修片回传的最终 JPG。
- **请求方法**：`GET`
- **路径**：`/api/images/:id/download/edited`
- **请求参数示例**：无
- **响应示例**：返回文件流
- **备注**：无

### [计划中] 生成 ZIP 下载包
- **用途**：将选中的多张图打包成 ZIP 下载。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/download/zip`
- **请求参数示例**：
  ```json
  { "imageIds": ["img_1", "img_2"] }
  ```
- **响应示例**：略
- **备注**：无

---

## 八、Edit Workflow 修图流转

### [计划中] 生成待修包
- **用途**：将状态为 edit 的图片原图及 manifest 打包。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/edit-package`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

### [计划中] 批量回传已修图
- **用途**：修片师将修好的 JPG 连同 manifest 一起上传。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/edited/upload`
- **请求参数示例**：`multipart/form-data`
- **响应示例**：略
- **备注**：无

### [计划中] 获取回传匹配结果
- **用途**：查看已修图通过 manifest 匹配原图的成功与失败记录。
- **请求方法**：`GET`
- **路径**：`/api/events/:eventId/edit-matches`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

---

## 九、Export 导出发布

### [计划中] 触发系统导出
- **用途**：将满足发布条件的图片，按配置规格批量压缩导出到 `导出/发布图` 目录。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/export`
- **请求参数示例**：
  ```json
  {
    "filter": { "rating_min": 4, "status": "publish" },
    "size": "3000px",
    "quality": 90
  }
  ```
- **响应示例**：略
- **备注**：返回 jobId 用于轮询进度。

### [计划中] 获取导出任务状态
- **用途**：查询后台导出的进度。
- **请求方法**：`GET`
- **路径**：`/api/exports/:jobId`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

### [计划中] 下载导出包
- **用途**：下载已经成功导出的压缩包。
- **请求方法**：`GET`
- **路径**：`/api/exports/:jobId/download`
- **请求参数示例**：无
- **响应示例**：返回文件流
- **备注**：无

---

## 十、Archive 活动归档

### [计划中] 准备归档
- **用途**：生成独立的归档目录及 `event.db`。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/prepare`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

### [计划中] 验证归档完整性
- **用途**：比对文件数量、hash，确保没有漏归档。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/verify`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

### [计划中] 清理工作区
- **用途**：用户确认归档无误后，安全删除 working 目录下的原活动文件。
- **请求方法**：`POST`
- **路径**：`/api/events/:eventId/archive/cleanup`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：主数据库中仅保留该活动的摘要信息。

### [计划中] 读取历史归档数据
- **用途**：打开只读的历史归档页面。
- **请求方法**：`GET`
- **路径**：`/api/archived-events/:id`
- **请求参数示例**：无
- **响应示例**：略
- **备注**：无

---

## 十一、Realtime 实时事件

客户端（通过局域网或本机）通过 Socket.IO 连接到主机，可监听以下事件：

- `image-created`：局域网有新图上传或本地扫描入库。
- `image-updated`：图片星级、状态、分类、标签等属性发生改变。
- `task-updated`：导入、导出、打包等后台耗时任务的进度更新。
- `export-created`：有新的成品发布包生成。
- `archive-updated`：活动的归档状态发生变动。
