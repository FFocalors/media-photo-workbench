# Media Photo Workbench / 融媒体图片工作台 - 测试记录

## v0.13.2-dev 发布后测试记录

- **版本**：v0.13.2-dev
- **发布类型**：Windows ZIP 便携预发布版
- **GitHub Release**：https://github.com/FFocalors/media-photo-workbench/releases/tag/v0.13.2-dev
- **推荐交付物**：`MediaPhotoWorkbench-v0.13.2-dev-x64.zip`
- **使用方式**：解压 ZIP 后双击 `Media Photo Workbench.exe`

### 已完成测试

- GitHub Release 已发布，Release 类型为 Pre-release。
- Windows ZIP 便携包已发布，解压后主程序可正常启动。
- 本机测试通过。
- 多设备局域网测试通过。
- 压力测试通过。
- 主机 Windows 热点测试通过。
- 主机首页真实端口、局域网地址、剩余空间和二维码可用。
- 客户端可通过主机首页复制局域网地址或扫描二维码访问主机。
- 核心流程已验证：主机导入、客户端上传、图片墙选片、实时同步、待修包、已修图回传、导出发布、轻量归档。

### 已知限制

- 当前仅支持 JPG/JPEG。
- 暂不支持 RAW / HEIC / 视频。
- 暂不支持远程传输、云同步、ngrok、FTP/SFTP。
- 校园网可能存在设备隔离；即使连接同一 Wi-Fi，客户端也可能无法访问主机。
- 局域网连接失败时，推荐使用主机 Windows 热点，常见主机地址为 `192.168.137.1`。
- 单文件 portable EXE 暂不作为推荐交付物。
- NSIS 安装包安装 / 卸载流程尚未作为发布推荐路径，需要在 v0.14.0-rc 补测。

## v0.14.0-rc 线下补测清单

- 防火墙 / 热点 / 校园网连接排查提示。
- 错误日志导出入口。
- 一键打开日志目录。
- NSIS 安装包安装、卸载、升级覆盖和用户数据保留补测。
- 多客户端并发上传复测。
- 真实活动压力测试复核，建议覆盖 50 / 300 / 500 张 JPG/JPEG。
- 启动速度记录与优化。
- README 故障排查章节完善。
