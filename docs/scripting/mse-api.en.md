# MSE API

[中文](mse-api.md) | English

MSE, MoonSprite Extension, is MoonSprite's dedicated Lua API. The current API version is `0.1.0` and remains `experimental`. This version describes only the Lua namespace contract and is not the application version.

## Runtime Discovery

```lua
print(mse.apiVersion)          -- "0.1.0"
print(mse.status.stage)        -- "experimental"
local capability = mse.capabilities.tiles
```

Each module in `mse.capabilities` provides:

- `status`: `stable`, `partial`, or `planned`.
- `readOnly`: whether the module is read-only. A planned module containing write endpoints reports `false`.
- `methods`: methods in declaration order, each with `name`, `implemented`, and `readOnly`; unimplemented methods also contain `error`.

`mse.isSupported(path)` accepts an endpoint path with or without the `mse.` prefix. Both `document.info` and `mse.document.info` are valid. An unknown path returns `false`.

## Implemented

### `mse.document.info()`

Returns read-only information about the current script target:

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

Returns a read-only summary of the current selection. With no selection, it still returns a table with `exists` false, `empty` true, and zero bounds. To avoid copying a large mask into a script at once, the first version does not expose mask pixels directly:

```lua
{
  exists = true,
  empty = false,
  hasMask = true,
  selectedPixels = 64,
  bounds = { x = 4, y = 8, width = 8, height = 8 }
}
```

## API Shape

The following module and method names are fixed as the first-version shape. Methods marked Planned exist in the `mse` table but currently throw:

```text
mse.<module>.<method> is not implemented yet
```

This allows scripts to implement capability detection in advance without mistaking incomplete operations for success.

| Module | Method shape | Current status |
| --- | --- | --- |
| `document` | `info`, `activeLayer`, `create`, `open`, `save` | `info` implemented; others planned |
| `layers` | `list`, `get`, `create`, `duplicate`, `remove`, `update` | Planned |
| `animation` | `frames`, `setFrame`, `loops`, `createLoop`, `updateLoop`, `removeLoop`, `play` | Planned |
| `palette` | `list`, `get`, `create`, `update`, `remove`, `extract` | Planned |
| `tiles` | `listSets`, `getSet`, `createSet`, `createLayer`, `place`, `edit` | Planned |
| `freeTiles` | `listSources`, `getSource`, `createSource`, `createLayer`, `place`, `edit` | Planned |
| `brushes` | `list`, `get`, `importImage`, `createFromSelection`, `remove` | Planned |
| `selection` | `info`, `set`, `clear`, `invert`, `transform` | `info` implemented; others planned |
| `slices` | `list`, `get`, `create`, `update`, `remove` | Planned |
| `styles` | `get`, `apply`, `copy`, `paste`, `clear`, `setEnabled` | Planned |
| `workspace` | `listPanels`, `getPanel`, `setPanel`, `showPanel`, `hidePanel` | Planned |
| `io` | `export`, `save`, `open` | Planned |
| `ui` | `notify`, `alert`, `dialog` | Planned |

## Design Constraints

MSE API write implementations must go through existing Store domain commands or document transactions and cannot let Lua hold or modify the complete project object directly. Every future write endpoint must define input validation, undo boundary, dirty and invalidation behavior, and failure rollback before moving from `planned` to `partial` or `stable`. Adding an endpoint updates the Rust capability table, LuaLS declarations, and this document together.
