use std::{cell::RefCell, rc::Rc};

use mlua::{Error as LuaError, Function, Lua, Result as LuaResult, Table, Value, Variadic};

use super::ScriptDocumentState;

/// The first public shape of the MoonSprite scripting namespace.
///
/// This is deliberately independent from the Aseprite compatibility surface. A
/// script can use `app` for compatibility and `mse` for MoonSprite-specific
/// features without either namespace silently changing the other.
pub(super) const API_VERSION: &str = "0.1.0";

#[derive(Clone, Copy)]
struct MethodDefinition {
    name: &'static str,
    implemented: bool,
    read_only: bool,
}

struct ModuleDefinition {
    name: &'static str,
    read_only: bool,
    methods: &'static [MethodDefinition],
}

const DOCUMENT_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "info",
        implemented: true,
        read_only: true,
    },
    MethodDefinition {
        name: "activeLayer",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "create",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "open",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "save",
        implemented: false,
        read_only: false,
    },
];

const LAYER_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "list",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "get",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "create",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "duplicate",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "remove",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "update",
        implemented: false,
        read_only: false,
    },
];

const ANIMATION_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "frames",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "setFrame",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "loops",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "createLoop",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "updateLoop",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "removeLoop",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "play",
        implemented: false,
        read_only: false,
    },
];

const PALETTE_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "list",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "get",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "create",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "update",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "remove",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "extract",
        implemented: false,
        read_only: false,
    },
];

const TILE_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "listSets",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "getSet",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "createSet",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "createLayer",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "place",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "edit",
        implemented: false,
        read_only: false,
    },
];

const FREE_TILE_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "listSources",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "getSource",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "createSource",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "createLayer",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "place",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "edit",
        implemented: false,
        read_only: false,
    },
];

const BRUSH_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "list",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "get",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "importImage",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "createFromSelection",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "remove",
        implemented: false,
        read_only: false,
    },
];

const SELECTION_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "info",
        implemented: true,
        read_only: true,
    },
    MethodDefinition {
        name: "set",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "clear",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "invert",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "transform",
        implemented: false,
        read_only: false,
    },
];

const SLICE_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "list",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "get",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "create",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "update",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "remove",
        implemented: false,
        read_only: false,
    },
];

const STYLE_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "get",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "apply",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "copy",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "paste",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "clear",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "setEnabled",
        implemented: false,
        read_only: false,
    },
];

const WORKSPACE_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "listPanels",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "getPanel",
        implemented: false,
        read_only: true,
    },
    MethodDefinition {
        name: "setPanel",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "showPanel",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "hidePanel",
        implemented: false,
        read_only: false,
    },
];

const IO_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "export",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "save",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "open",
        implemented: false,
        read_only: false,
    },
];

const UI_METHODS: &[MethodDefinition] = &[
    MethodDefinition {
        name: "notify",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "alert",
        implemented: false,
        read_only: false,
    },
    MethodDefinition {
        name: "dialog",
        implemented: false,
        read_only: false,
    },
];

const MODULES: &[ModuleDefinition] = &[
    ModuleDefinition {
        name: "document",
        read_only: false,
        methods: DOCUMENT_METHODS,
    },
    ModuleDefinition {
        name: "layers",
        read_only: false,
        methods: LAYER_METHODS,
    },
    ModuleDefinition {
        name: "animation",
        read_only: false,
        methods: ANIMATION_METHODS,
    },
    ModuleDefinition {
        name: "palette",
        read_only: false,
        methods: PALETTE_METHODS,
    },
    ModuleDefinition {
        name: "tiles",
        read_only: false,
        methods: TILE_METHODS,
    },
    ModuleDefinition {
        name: "freeTiles",
        read_only: false,
        methods: FREE_TILE_METHODS,
    },
    ModuleDefinition {
        name: "brushes",
        read_only: false,
        methods: BRUSH_METHODS,
    },
    ModuleDefinition {
        name: "selection",
        read_only: false,
        methods: SELECTION_METHODS,
    },
    ModuleDefinition {
        name: "slices",
        read_only: false,
        methods: SLICE_METHODS,
    },
    ModuleDefinition {
        name: "styles",
        read_only: false,
        methods: STYLE_METHODS,
    },
    ModuleDefinition {
        name: "workspace",
        read_only: false,
        methods: WORKSPACE_METHODS,
    },
    ModuleDefinition {
        name: "io",
        read_only: false,
        methods: IO_METHODS,
    },
    ModuleDefinition {
        name: "ui",
        read_only: false,
        methods: UI_METHODS,
    },
];

pub(super) fn install(lua: &Lua, document: Rc<RefCell<ScriptDocumentState>>) -> LuaResult<()> {
    let mse = lua.create_table()?;
    mse.set("apiVersion", API_VERSION)?;

    let status = lua.create_table()?;
    status.set("name", "MoonSprite")?;
    status.set("namespace", "mse")?;
    status.set("apiVersion", API_VERSION)?;
    status.set("runtimeVersion", env!("CARGO_PKG_VERSION"))?;
    status.set("stage", "experimental")?;
    status.set("compatibility", "MoonSprite-specific API")?;
    mse.set("status", status)?;

    let capabilities = lua.create_table()?;
    for module in MODULES {
        let capability = lua.create_table()?;
        capability.set("status", module_status(module.methods))?;
        capability.set("readOnly", module.read_only)?;
        let methods = lua.create_table()?;
        for (index, method) in module.methods.iter().enumerate() {
            let entry = lua.create_table()?;
            entry.set("name", method.name)?;
            entry.set("implemented", method.implemented)?;
            entry.set("readOnly", method.read_only)?;
            if !method.implemented {
                entry.set(
                    "error",
                    format!("mse.{}.{} is not implemented yet", module.name, method.name),
                )?;
            }
            methods.set(index + 1, entry)?;
        }
        capability.set("methods", methods)?;
        capabilities.set(module.name, capability)?;
    }
    mse.set("capabilities", capabilities)?;

    mse.set(
        "isSupported",
        lua.create_function(|_, path: String| Ok(is_supported_path(&path)))?,
    )?;

    for module in MODULES {
        let table = lua.create_table()?;
        for method in module.methods {
            let path = format!("{}.{}", module.name, method.name);
            let function = match path.as_str() {
                "document.info" => {
                    let target = document.clone();
                    lua.create_function(move |lua, _: Variadic<Value>| document_info(lua, &target))?
                }
                "selection.info" => {
                    let target = document.clone();
                    lua.create_function(move |lua, _: Variadic<Value>| {
                        selection_info(lua, &target)
                    })?
                }
                _ => unsupported_function(lua, &path)?,
            };
            table.set(method.name, function)?;
        }
        mse.set(module.name, table)?;
    }

    lua.globals().set("mse", mse)?;
    Ok(())
}

fn module_status(methods: &[MethodDefinition]) -> &'static str {
    if methods.iter().all(|method| method.implemented) {
        "stable"
    } else if methods.iter().any(|method| method.implemented) {
        "partial"
    } else {
        "planned"
    }
}

fn is_supported_path(path: &str) -> bool {
    let path = path.trim().strip_prefix("mse.").unwrap_or(path.trim());
    matches!(
        path,
        "apiVersion"
            | "status"
            | "capabilities"
            | "isSupported"
            | "document.info"
            | "selection.info"
    )
}

fn unsupported_function(lua: &Lua, path: &str) -> LuaResult<Function> {
    let message = format!("mse.{path} is not implemented yet");
    lua.create_function(move |_, _: Variadic<Value>| -> LuaResult<Value> {
        Err(LuaError::RuntimeError(message.clone()))
    })
}

fn document_info(lua: &Lua, document: &Rc<RefCell<ScriptDocumentState>>) -> LuaResult<Table> {
    let snapshot = {
        let document = document.borrow();
        let layer = document.active_layer.borrow();
        let image = document.active_image.borrow();
        (
            document.document_id.clone(),
            document.document_name.clone(),
            document.document_file_path.clone(),
            document.document_width,
            document.document_height,
            image.mode.document_color_mode().to_string(),
            document.active_frame_number(),
            layer.id.clone(),
            layer.name.clone(),
            image.width as u32,
            image.height as u32,
            document.offset_x,
            document.offset_y,
            layer.opacity,
            layer.visible,
            layer.locked,
            image.mode.document_format().to_string(),
        )
    };

    let info = lua.create_table()?;
    info.set("id", snapshot.0)?;
    info.set("name", snapshot.1)?;
    info.set("filePath", snapshot.2)?;
    info.set("width", snapshot.3)?;
    info.set("height", snapshot.4)?;
    info.set("colorMode", snapshot.5)?;
    info.set("frame", snapshot.6)?;

    let active_layer = lua.create_table()?;
    active_layer.set("id", snapshot.7)?;
    active_layer.set("name", snapshot.8)?;
    active_layer.set("width", snapshot.9)?;
    active_layer.set("height", snapshot.10)?;
    active_layer.set("x", snapshot.11)?;
    active_layer.set("y", snapshot.12)?;
    active_layer.set("opacity", snapshot.13)?;
    active_layer.set("visible", snapshot.14)?;
    active_layer.set("locked", snapshot.15)?;
    active_layer.set("format", snapshot.16)?;
    info.set("activeLayer", active_layer)?;
    Ok(info)
}

fn selection_info(lua: &Lua, document: &Rc<RefCell<ScriptDocumentState>>) -> LuaResult<Table> {
    let selection = document.borrow().selection.clone();
    let (exists, empty, x, y, width, height, has_mask, selected_pixels) = match selection {
        Some(selection) => {
            let selected_pixels = selection
                .mask
                .as_ref()
                .map(|mask| mask.iter().filter(|value| **value != 0).count() as u64)
                .unwrap_or_else(|| selection.width as u64 * selection.height as u64);
            (
                true,
                selected_pixels == 0,
                selection.x,
                selection.y,
                selection.width,
                selection.height,
                selection.mask.is_some(),
                selected_pixels,
            )
        }
        None => (false, true, 0, 0, 0, 0, false, 0),
    };

    let info = lua.create_table()?;
    info.set("exists", exists)?;
    info.set("empty", empty)?;
    info.set("hasMask", has_mask)?;
    info.set("selectedPixels", selected_pixels)?;
    let bounds = lua.create_table()?;
    bounds.set("x", x)?;
    bounds.set("y", y)?;
    bounds.set("width", width)?;
    bounds.set("height", height)?;
    info.set("bounds", bounds)?;
    Ok(info)
}
