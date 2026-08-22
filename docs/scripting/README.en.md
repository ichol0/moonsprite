# Lua Scripting

[中文](README.md) | English

MoonSprite scripts run in a restricted Lua 5.4 sandbox. Ordinary script files are placed in the executable-root `scripts` directory and opened from File > Scripts. `.msext` extensions can insert commands into existing menus, create top-level menus, or provide floating panels through Window > Panels. Every entry reuses the same runtime. Scripts cannot directly read or write files, start processes, access the network, or load arbitrary Lua packages.

## Runnable Extensions

An extension package is a ZIP container whose root `manifest.json` can declare multiple Lua commands and MoonSprite-rendered panels:

```json
{
  "schemaVersion": 1,
  "id": "com.example.sample",
  "name": "Sample Extension",
  "version": "1.0.0",
  "description": "Example extension contributions.",
  "commands": [
    {
      "id": "paint-center",
      "name": "Paint Center Pixel",
      "description": "Writes one undoable test pixel.",
      "entry": "commands/paint-center.lua"
    }
  ],
  "panels": [
    {
      "id": "smoke-tools",
      "name": "Smoke Tools",
      "description": "Commands contributed by this extension.",
      "defaultVisible": true,
      "commands": ["paint-center"]
    }
  ],
  "menuItems": [
    {
      "id": "file-paint",
      "menu": "file",
      "position": "end",
      "commands": ["paint-center"]
    }
  ],
  "topMenus": [
    {
      "id": "sample-tools",
      "name": "Sample Tools",
      "position": "before:help",
      "commands": ["paint-center"]
    }
  ]
}
```

After installation, an extension contributes menu commands and panels only while enabled. `commands[]` declares runnable commands identified internally as `extension:<extensionId>:<commandId>`. `menuItems[]` chooses the start or end of a built-in menu. `topMenus[]` declares a new top-level menu and its relative position. `panels[]` declares a floating panel toggleable under Window > Panels. Every command ID reference is case-sensitive.

Clicking a menu item or panel button gives the command the same current-document, layer, frame, and selection snapshot as an ordinary Lua script. Pixel changes, transactions, dialogs, undo, and failure rollback follow the same script rules. Disabling or uninstalling an extension, or failing entry-file security validation, removes the command and panel. A path passed from the Renderer cannot force execution.

MoonSprite does not provide a fixed top-level Extensions menu. For early-extension compatibility, the root manifest may still provide one `entry`, identified as `extension:<id>` and shown under File > Scripts. Named commands not referenced by any menu or panel also fall back to that list. New extensions should prefer named `commands[]` and explicit UI contributions. Extension UI is declarative: an extension cannot inject React, DOM, CSS, JavaScript, or native controls and cannot use `require` to load package or system files.

Canvas-writing commands should use an explicit transaction so one command becomes one undo step:

```lua
app.transaction("Extension paint", function()
  app.activeImage:putPixel(0, 0, app.pixelColor.rgba(41, 121, 255, 255))
end)
```

## Two Namespaces

- `app.*` is the Aseprite-compatible API. It supports migration of existing scripts and currently implements only the subset explicitly documented by the project.
- `mse.*` is the MoonSprite-specific API. It does not pretend to be Aseprite and does not expose internal `SpriteDocument` or Renderer state.

See [mse-api.en.md](mse-api.en.md) for the complete MSE API shape, endpoint status, and error conventions. Editor type hints are in [mse-api.lua](mse-api.lua), which can be added to a VS Code LuaLS workspace library path.

## Currently Available Interfaces

The first release exposes only safe read-only queries:

```lua
local document = mse.document.info()
local selection = mse.selection.info()
```

Scripts can use `mse.apiVersion`, `mse.status`, and `mse.capabilities` to inspect runtime version and endpoint state, or `mse.isSupported("document.info")` for capability detection. Planned endpoints already appear in the capability table but raise explicit errors when called and never silently succeed.

See [examples/intro.lua](examples/intro.lua) for a runnable example.
