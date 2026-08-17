# 变更记录

本文件只保留当前“未发布”热区和历史版本索引。完整已发布记录按版本存放在 `docs/changelog/`，避免日常开发读取无关历史。

## 未发布

### 新增

### 优化

### 修复

- 修复不同 DEV 版本共用单实例锁，导致新版运行时旧版无法启动的问题；同一版本仍保持单实例。
- 修复旧工程首页预览和较大 Aseprite 文件在解码 Worker 中误加载浏览器专用 PNG 入口，报错 `window is not defined` 而无法打开的问题。

## 版本索引

| 版本 | 完整记录 |
| --- | --- |
| `DEV.5` | [查看 DEV.5 完整更新记录](docs/changelog/DEV.5.md) |
| `DEV.4` | [查看 DEV.4 完整更新记录](docs/changelog/DEV.4.md) |
| `DEV.3` | [查看 DEV.3 完整更新记录](docs/changelog/DEV.3.md) |
| `DEV.2` | [查看 DEV.2 完整更新记录](docs/changelog/DEV.2.md) |
