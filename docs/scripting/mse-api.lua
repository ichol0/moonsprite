---@meta

--- MoonSprite MSE API LuaLS declarations.
--- MoonSprite MSE API 的 LuaLS 类型声明。

---@alias MseColorMode "rgba" | "grayscale" | "indexed"
---@alias MseModuleStatus "stable" | "partial" | "planned"

---@class MseMethodCapability
---@field name string
---@field implemented boolean
---@field readOnly boolean
---@field error? string

---@class MseModuleCapability
---@field status MseModuleStatus
---@field readOnly boolean
---@field methods MseMethodCapability[]

---@class MseCapabilities
---@field document MseModuleCapability
---@field layers MseModuleCapability
---@field animation MseModuleCapability
---@field palette MseModuleCapability
---@field tiles MseModuleCapability
---@field freeTiles MseModuleCapability
---@field brushes MseModuleCapability
---@field selection MseModuleCapability
---@field slices MseModuleCapability
---@field styles MseModuleCapability
---@field workspace MseModuleCapability
---@field io MseModuleCapability
---@field ui MseModuleCapability

---@class MseStatus
---@field name string
---@field namespace string
---@field apiVersion string
---@field runtimeVersion string
---@field stage "experimental"
---@field compatibility string

---@class MseBounds
---@field x integer
---@field y integer
---@field width integer
---@field height integer

---@class MseActiveLayerInfo
---@field id string
---@field name string
---@field width integer
---@field height integer
---@field x integer
---@field y integer
---@field opacity integer 0-255
---@field visible boolean
---@field locked boolean
---@field format "rgba" | "indexed"

---@class MseDocumentInfo
---@field id string
---@field name string
---@field filePath string
---@field width integer
---@field height integer
---@field colorMode MseColorMode
---@field frame integer
---@field activeLayer MseActiveLayerInfo

---@class MseSelectionInfo
---@field exists boolean
---@field empty boolean
---@field hasMask boolean
---@field selectedPixels integer
---@field bounds MseBounds

---@alias MsePlannedFunction fun(...: any): any

---@class MseDocumentApi
---@field info fun(): MseDocumentInfo
---@field activeLayer MsePlannedFunction
---@field create MsePlannedFunction
---@field open MsePlannedFunction
---@field save MsePlannedFunction

---@class MseLayersApi
---@field list MsePlannedFunction
---@field get MsePlannedFunction
---@field create MsePlannedFunction
---@field duplicate MsePlannedFunction
---@field remove MsePlannedFunction
---@field update MsePlannedFunction

---@class MseAnimationApi
---@field frames MsePlannedFunction
---@field setFrame MsePlannedFunction
---@field loops MsePlannedFunction
---@field createLoop MsePlannedFunction
---@field updateLoop MsePlannedFunction
---@field removeLoop MsePlannedFunction
---@field play MsePlannedFunction

---@class MsePaletteApi
---@field list MsePlannedFunction
---@field get MsePlannedFunction
---@field create MsePlannedFunction
---@field update MsePlannedFunction
---@field remove MsePlannedFunction
---@field extract MsePlannedFunction

---@class MseTilesApi
---@field listSets MsePlannedFunction
---@field getSet MsePlannedFunction
---@field createSet MsePlannedFunction
---@field createLayer MsePlannedFunction
---@field place MsePlannedFunction
---@field edit MsePlannedFunction

---@class MseFreeTilesApi
---@field listSources MsePlannedFunction
---@field getSource MsePlannedFunction
---@field createSource MsePlannedFunction
---@field createLayer MsePlannedFunction
---@field place MsePlannedFunction
---@field edit MsePlannedFunction

---@class MseBrushesApi
---@field list MsePlannedFunction
---@field get MsePlannedFunction
---@field importImage MsePlannedFunction
---@field createFromSelection MsePlannedFunction
---@field remove MsePlannedFunction

---@class MseSelectionApi
---@field info fun(): MseSelectionInfo
---@field set MsePlannedFunction
---@field clear MsePlannedFunction
---@field invert MsePlannedFunction
---@field transform MsePlannedFunction

---@class MseSlicesApi
---@field list MsePlannedFunction
---@field get MsePlannedFunction
---@field create MsePlannedFunction
---@field update MsePlannedFunction
---@field remove MsePlannedFunction

---@class MseStylesApi
---@field get MsePlannedFunction
---@field apply MsePlannedFunction
---@field copy MsePlannedFunction
---@field paste MsePlannedFunction
---@field clear MsePlannedFunction
---@field setEnabled MsePlannedFunction

---@class MseWorkspaceApi
---@field listPanels MsePlannedFunction
---@field getPanel MsePlannedFunction
---@field setPanel MsePlannedFunction
---@field showPanel MsePlannedFunction
---@field hidePanel MsePlannedFunction

---@class MseIoApi
---@field export MsePlannedFunction
---@field save MsePlannedFunction
---@field open MsePlannedFunction

---@class MseUiApi
---@field notify MsePlannedFunction
---@field alert MsePlannedFunction
---@field dialog MsePlannedFunction

---@class MseApi
---@field apiVersion string
---@field status MseStatus
---@field capabilities MseCapabilities
---@field isSupported fun(path: string): boolean
---@field document MseDocumentApi
---@field layers MseLayersApi
---@field animation MseAnimationApi
---@field palette MsePaletteApi
---@field tiles MseTilesApi
---@field freeTiles MseFreeTilesApi
---@field brushes MseBrushesApi
---@field selection MseSelectionApi
---@field slices MseSlicesApi
---@field styles MseStylesApi
---@field workspace MseWorkspaceApi
---@field io MseIoApi
---@field ui MseUiApi

---@type MseApi
mse = {}
