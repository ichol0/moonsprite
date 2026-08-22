# MSE API

中文 | [English](mse-api.en.md)

MSE（MoonSprite Extension）是 MoonSprite 的专属 Lua API。当前 API 版本为 `0.1.0`，仍处于 `experimental` 阶段；版本只描述 Lua 命名空间契约，不等同于软件版本号。

## 运行时发现

```lua
print(mse.apiVersion)          -- "0.1.0"
print(mse.status.stage)        -- "experimental"
local capability = mse.capabilities.tiles
```

`mse.capabilities` 按模块提供以下字段：

- `status`：`stable`、`partial` 或 `planned`。
- `readOnly`：模块是否只读。规划中包含写入端点的模块为 `false`。
- `methods`：按声明顺序排列的方法表，每项包含 `name`、`implemented`、`readOnly`；未实现项还包含 `error`。

`mse.isSupported(path)` 接受不带或带 `mse.` 前缀的端点路径。例如 `document.info` 与 `mse.document.info` 都是合法探测写法。未知路径返回 `false`。

## 已实现

### `mse.document.info()`

返回当前脚本目标的只读文档信息：

```lua
{
  id = "...",
  name = "...",
  filePath = "...",
  width = 128,
  height = 128,
  colorMode = "rgba", -- rgba / grayscale / indexed
  frame = 1,
  activeLayer = {
    id = "...",
    name = "Layer 1",
    width = 128,
    height = 128,
    x = 0,
    y = 0,
    opacity = 255,
    visible = true,
    locked = false,
    format = "rgba"
  }
}
```

### `mse.selection.info()`

返回当前选区的只读摘要。没有选区时仍返回表，`exists` 为 `false`，`empty` 为 `true`，`bounds` 为零矩形。为避免脚本一次性复制大掩码，首版不直接暴露掩码像素：

```lua
{
  exists = true,
  empty = false,
  hasMask = true,
  selectedPixels = 64,
  bounds = { x = 4, y = 8, width = 8, height = 8 }
}
```

## API 外形

以下模块和方法名已经固定为首版外形。标记为“规划中”的方法会存在于 `mse` 表中，但当前调用会抛出：

```text
mse.<module>.<method> is not implemented yet
```

这样脚本可以提前编写能力探测，而不会把未完成操作误认为成功。

| 模块 | 方法外形 | 当前状态 |
| --- | --- | --- |
| `document` | `info`, `activeLayer`, `create`, `open`, `save` | `info` 已实现，其余规划中 |
| `layers` | `list`, `get`, `create`, `duplicate`, `remove`, `update` | 规划中 |
| `animation` | `frames`, `setFrame`, `loops`, `createLoop`, `updateLoop`, `removeLoop`, `play` | 规划中 |
| `palette` | `list`, `get`, `create`, `update`, `remove`, `extract` | 规划中 |
| `tiles` | `listSets`, `getSet`, `createSet`, `createLayer`, `place`, `edit` | 规划中 |
| `freeTiles` | `listSources`, `getSource`, `createSource`, `createLayer`, `place`, `edit` | 规划中 |
| `brushes` | `list`, `get`, `importImage`, `createFromSelection`, `remove` | 规划中 |
| `selection` | `info`, `set`, `clear`, `invert`, `transform` | `info` 已实现，其余规划中 |
| `slices` | `list`, `get`, `create`, `update`, `remove` | 规划中 |
| `styles` | `get`, `apply`, `copy`, `paste`, `clear`, `setEnabled` | 规划中 |
| `workspace` | `listPanels`, `getPanel`, `setPanel`, `showPanel`, `hidePanel` | 规划中 |
| `io` | `export`, `save`, `open` | 规划中 |
| `ui` | `notify`, `alert`, `dialog` | 规划中 |

## 设计约束

MSE API 的写入实现必须经过现有 Store 领域命令或文档事务，不能让 Lua 直接持有或改写完整工程对象。每个后续写入端点都需要定义输入校验、撤销边界、dirty/invalidation 行为和失败回滚，再从 `planned` 变为 `partial` 或 `stable`。新增端点时同步更新 Rust 能力表、LuaLS 声明和本文件。
