# MoonSprite 文件格式 v1

`.moonsprite` 是 ZIP 容器，包含：

- `manifest.json`：文档元数据、调色板、图层顺序和格式版本。
- `layers/<id>.rgba`：小端序 RGBA 字节，每像素四字节。
- `layers/<id>.idx32`：小端序无符号 32 位稳定调色板 ID。
- `preview.png`：可见图层合成后的预览图。

当 `app` 不是 `MoonSprite`、`schemaVersion` 不是 `1`、尺寸非法、图层数据缺失或字节长度异常时，读取器必须拒绝打开。未知未来版本不得静默降级读取。

索引颜色文档保留颜色 ID `0` 表示透明；其他颜色 ID 在调色板重排后保持稳定。导出 PNG 时，只有合成结果不超过 256 个唯一颜色才保留索引输出，否则导出等效 RGBA 图像。

修改格式时必须新增迁移策略、兼容测试和 ADR，不得直接改变现有 v1 语义。
