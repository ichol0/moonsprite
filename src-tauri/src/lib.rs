#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use arboard::{Clipboard, ImageData};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use sysinfo::System;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};

mod close_coordinator;
mod platform_dialogs;
mod platform_paths;
mod platform_storage;
use close_coordinator::CloseCoordinator;
use platform_dialogs::{image_export_filter, project_save_filter};
use platform_paths::ensure_executable_subdirectory;
use platform_storage::atomic_write;

#[derive(Default)]
struct AppState {
    previous_session_crashed: Mutex<bool>,
    close_requests: Arc<CloseCoordinator>,
    startup_files: Mutex<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenDialogResult {
    canceled: bool,
    file_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveDialogResult {
    canceled: bool,
    file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardImage {
    width: usize,
    height: usize,
    data: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryRecord {
    id: String,
    name: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryProject {
    file_path: String,
    file_name: String,
    modified_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryListing {
    directory_path: String,
    projects: Vec<GalleryProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaletteColor {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaletteDiskFile {
    schema_version: u32,
    id: String,
    name: String,
    colors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPalette {
    id: String,
    name: String,
    file_path: String,
    colors: Vec<PaletteColor>,
    built_in: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaletteListing {
    directory_path: String,
    palettes: Vec<StoredPalette>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDiskFile {
    schema_version: u32,
    id: String,
    name: String,
    updated_at: String,
    layout: serde_json::Value,
    #[serde(default)]
    initial_layout: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredWorkspace {
    id: String,
    name: String,
    file_path: String,
    updated_at: String,
    built_in: bool,
    layout: serde_json::Value,
    initial_layout: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceListing {
    directory_path: String,
    workspaces: Vec<StoredWorkspace>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredBrush {
    id: String,
    name: String,
    file_path: String,
    intrinsic_size: bool,
    source_x: Option<i32>,
    source_y: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct BrushMetadata {
    intrinsic_size: bool,
    source_x: Option<i32>,
    source_y: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrushListing {
    directory_path: String,
    brushes: Vec<StoredBrush>,
}

const DEFAULT_PALETTES: &[(&str, &str)] = &[
    (
        "moonlight-12.palette.json",
        include_str!("../../palettes/moonlight-12.palette.json"),
    ),
    (
        "tiny-console-16.palette.json",
        include_str!("../../palettes/tiny-console-16.palette.json"),
    ),
    (
        "forest-dusk-12.palette.json",
        include_str!("../../palettes/forest-dusk-12.palette.json"),
    ),
    (
        "sunset-12.palette.json",
        include_str!("../../palettes/sunset-12.palette.json"),
    ),
    (
        "mono-10.palette.json",
        include_str!("../../palettes/mono-10.palette.json"),
    ),
];

const BUILTIN_EXAMPLE_FILE_NAME: &str = "示例.moonsprite";
const BUILTIN_EXAMPLE: &[u8] = include_bytes!("../resources/示例.moonsprite");
const BUILTIN_EXAMPLE_MARKER_VERSION: &str = "2";
const BUILTIN_EXAMPLE_DELETED: &str = "deleted";

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("recovery"))
}

fn startup_file_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| {
                        matches!(
                            value.to_ascii_lowercase().as_str(),
                            "moonsprite" | "ase" | "aseprite" | "png"
                        )
                    })
        })
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn take_startup_files(state: State<'_, AppState>) -> Vec<String> {
    let Ok(mut files) = state.startup_files.lock() else {
        return Vec::new();
    };
    std::mem::take(&mut *files)
}

fn gallery_dir() -> Result<PathBuf, String> {
    ensure_executable_subdirectory("gallery", "图库")
}

fn builtin_example_marker(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("builtin-example-installed.v1"))
}

#[tauri::command]
fn ensure_builtin_example(app: AppHandle) -> Result<Option<String>, String> {
    let marker = builtin_example_marker(&app)?;
    let example_path = gallery_dir()?.join(BUILTIN_EXAMPLE_FILE_NAME);
    if example_path.is_file() {
        return Ok(Some(example_path.to_string_lossy().to_string()));
    }
    let marker_state = fs::read_to_string(&marker).ok();
    if marker_state.as_deref().map(str::trim) == Some(BUILTIN_EXAMPLE_DELETED) {
        return Ok(None);
    }
    atomic_write(&example_path, BUILTIN_EXAMPLE)
        .map_err(|error| format!("无法安装内置示例工程：{error}"))?;
    atomic_write(&marker, BUILTIN_EXAMPLE_MARKER_VERSION.as_bytes())
        .map_err(|error| format!("无法记录内置示例工程状态：{error}"))?;
    Ok(Some(example_path.to_string_lossy().to_string()))
}

fn palette_dir() -> Result<PathBuf, String> {
    let directory = ensure_executable_subdirectory("palettes", "色板")?;
    // Built-in palettes are embedded resources. Remove copies created by older builds so
    // the user palette directory contains only user-owned files.
    for (file_name, _) in DEFAULT_PALETTES {
        let _ = fs::remove_file(directory.join(file_name));
    }
    Ok(directory)
}

fn brush_dir() -> Result<PathBuf, String> {
    ensure_executable_subdirectory("brushes", "笔刷")
}

fn workspace_dir() -> Result<PathBuf, String> {
    ensure_executable_subdirectory("workspaces", "工作区")
}

fn session_marker(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("session-state.json"))
}

fn uuid_suffix() -> String {
    format!("{}-{}", std::process::id(), chrono_like_timestamp())
}

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn mark_session(app: &AppHandle, clean: bool) -> Result<(), String> {
    let payload = serde_json::json!({ "clean": clean, "updatedAt": chrono_like_timestamp() });
    atomic_write(&session_marker(app)?, payload.to_string().as_bytes())
}

fn initialize_session_marker(app: &AppHandle, state: &AppState) -> Result<(), String> {
    migrate_legacy_data(app)?;
    let marker = session_marker(app)?;
    let crashed = fs::read_to_string(marker)
        .ok()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
        .and_then(|value| value.get("clean").and_then(serde_json::Value::as_bool))
        .map(|clean| !clean)
        .unwrap_or(false);
    *state
        .previous_session_crashed
        .lock()
        .map_err(|_| "恢复状态锁不可用")? = crashed;
    mark_session(app, false)
}

fn migrate_legacy_data(app: &AppHandle) -> Result<(), String> {
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return Ok(());
    };
    let legacy = PathBuf::from(roaming).join("moonsprite");
    let current = app_data_dir(app)?;
    if !legacy.exists() || legacy == current {
        return Ok(());
    }
    fs::create_dir_all(&current).map_err(|error| error.to_string())?;
    let legacy_marker = legacy.join("session-state.json");
    let current_marker = current.join("session-state.json");
    if legacy_marker.exists() && !current_marker.exists() {
        fs::copy(legacy_marker, current_marker).map_err(|error| error.to_string())?;
    }
    let legacy_recovery = legacy.join("recovery");
    let current_recovery = current.join("recovery");
    if legacy_recovery.exists() && !current_recovery.exists() {
        fs::create_dir_all(&current_recovery).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(legacy_recovery).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    fs::copy(&path, current_recovery.join(name))
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    Ok(())
}

fn safe_recovery_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || !id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
    {
        return Err("无效的恢复文件 ID".to_string());
    }
    Ok(id)
}

fn file_dialog(default_path: Option<&str>) -> FileDialog {
    let mut dialog = FileDialog::new();
    if let Some(path) = default_path {
        let path = PathBuf::from(path);
        if let Some(parent) = path.parent() {
            if parent.exists() {
                dialog = dialog.set_directory(parent);
            }
        }
        if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
            dialog = dialog.set_file_name(name);
        }
    }
    dialog
}

#[tauri::command]
fn open_files() -> OpenDialogResult {
    let paths = FileDialog::new()
        .add_filter("Aseprite files", &["ase", "aseprite"])
        .add_filter("MoonSprite 工程或 PNG", &["moonsprite", "png"])
        .add_filter("MoonSprite 工程", &["moonsprite"])
        .add_filter("PNG 图片", &["png"])
        .pick_files();
    let file_paths = paths
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    OpenDialogResult {
        canceled: file_paths.is_empty(),
        file_paths,
    }
}

#[tauri::command]
fn save_project(default_path: Option<String>, format: Option<String>) -> SaveDialogResult {
    let has_explicit_directory = default_path
        .as_deref()
        .and_then(|value| Path::new(value).parent())
        .is_some_and(|parent| !parent.as_os_str().is_empty());
    let mut dialog = file_dialog(default_path.as_deref());
    if !has_explicit_directory {
        if let Ok(directory) = gallery_dir() {
            dialog = dialog.set_directory(directory);
        }
    }
    let (label, extensions) = project_save_filter(format.as_deref());
    let path = dialog.add_filter(label, &extensions).save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn export_image(default_path: Option<String>, format: String) -> SaveDialogResult {
    let (label, extensions) = image_export_filter(&format);
    let path = file_dialog(default_path.as_deref())
        .add_filter(label, &extensions)
        .save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn save_palette_image(default_path: Option<String>) -> SaveDialogResult {
    let path = file_dialog(default_path.as_deref())
        .add_filter("PNG 色板图像", &["png"])
        .save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

fn parse_palette_color(value: &str) -> Result<PaletteColor, String> {
    let hex = value.strip_prefix('#').unwrap_or(value);
    if hex.len() != 6 && hex.len() != 8 {
        return Err(format!("无效的色板颜色：{value}"));
    }
    let number = u32::from_str_radix(hex, 16).map_err(|_| format!("无效的色板颜色：{value}"))?;
    let alpha = if hex.len() == 8 { number as u8 } else { 255 };
    let rgb = if hex.len() == 8 { number >> 8 } else { number };
    Ok(PaletteColor {
        r: (rgb >> 16) as u8,
        g: (rgb >> 8) as u8,
        b: rgb as u8,
        a: alpha,
    })
}

fn palette_color_hex(color: &PaletteColor) -> String {
    format!(
        "#{:02X}{:02X}{:02X}{:02X}",
        color.r, color.g, color.b, color.a
    )
}

fn valid_palette_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn palette_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            separator = false;
        } else if (character == '-' || character == '_' || character.is_whitespace())
            && !slug.is_empty()
            && !separator
        {
            slug.push('-');
            separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        format!("palette-{}", chrono_like_timestamp())
    } else {
        slug
    }
}

fn stored_palette_from_file(
    file: PaletteDiskFile,
    file_path: String,
    built_in: bool,
    source: &str,
) -> Result<StoredPalette, String> {
    if file.schema_version != 1 {
        return Err(format!("不支持色板版本 {}：{source}", file.schema_version));
    }
    if !valid_palette_id(&file.id) || file.name.trim().is_empty() {
        return Err(format!("色板信息无效：{source}"));
    }
    let colors = file
        .colors
        .iter()
        .map(|color| parse_palette_color(color))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(StoredPalette {
        id: file.id,
        name: file.name,
        file_path,
        colors,
        built_in,
    })
}

fn read_palette(path: &Path) -> Result<StoredPalette, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("无法读取色板 {}：{error}", path.display()))?;
    let file: PaletteDiskFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("色板文件损坏 {}：{error}", path.display()))?;
    stored_palette_from_file(
        file,
        path.to_string_lossy().to_string(),
        false,
        &path.display().to_string(),
    )
}

fn read_built_in_palette(contents: &str) -> Result<StoredPalette, String> {
    let file: PaletteDiskFile =
        serde_json::from_str(contents).map_err(|error| format!("内置色板资源损坏：{error}"))?;
    stored_palette_from_file(file, String::new(), true, "内置色板")
}

fn is_built_in_palette_id(id: &str) -> bool {
    DEFAULT_PALETTES
        .iter()
        .any(|(file_name, _)| file_name.strip_suffix(".palette.json") == Some(id))
}

#[tauri::command]
fn list_palettes() -> Result<PaletteListing, String> {
    let directory = palette_dir()?;
    let mut palettes = DEFAULT_PALETTES
        .iter()
        .map(|(_, contents)| read_built_in_palette(contents))
        .collect::<Result<Vec<_>, _>>()?;
    for entry in fs::read_dir(&directory).map_err(|error| format!("无法读取色板文件夹：{error}"))?
    {
        let path = entry
            .map_err(|error| format!("无法读取色板文件：{error}"))?
            .path();
        let is_palette = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.ends_with(".palette.json"))
            .unwrap_or(false);
        if path.is_file() && is_palette {
            let palette = read_palette(&path)?;
            if !is_built_in_palette_id(&palette.id) {
                palettes.push(palette);
            }
        }
    }
    palettes.sort_by(|left, right| {
        right.built_in.cmp(&left.built_in).then_with(|| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.id.cmp(&right.id))
        })
    });
    Ok(PaletteListing {
        directory_path: directory.to_string_lossy().to_string(),
        palettes,
    })
}

#[tauri::command]
fn save_palette(
    id: Option<String>,
    name: String,
    colors: Vec<PaletteColor>,
) -> Result<StoredPalette, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("色板名称不能为空。".to_string());
    }
    if colors.is_empty() {
        return Err("色板至少需要一种颜色。".to_string());
    }
    if colors.len() > 65_536 {
        return Err("单个色板最多保存 65536 种颜色。".to_string());
    }
    let directory = palette_dir()?;
    let palette_id = match id {
        Some(value) if valid_palette_id(&value) && !is_built_in_palette_id(&value) => value,
        Some(_) => return Err("色板 ID 无效。".to_string()),
        None => {
            let base = palette_slug(name);
            let mut candidate = base.clone();
            let mut suffix = 2;
            while is_built_in_palette_id(&candidate)
                || directory.join(format!("{candidate}.palette.json")).exists()
            {
                candidate = format!("{base}-{suffix}");
                suffix += 1;
            }
            candidate
        }
    };
    let path = directory.join(format!("{palette_id}.palette.json"));
    let file = PaletteDiskFile {
        schema_version: 1,
        id: palette_id,
        name: name.to_string(),
        colors: colors.iter().map(palette_color_hex).collect(),
    };
    let encoded = serde_json::to_vec_pretty(&file).map_err(|error| error.to_string())?;
    atomic_write(&path, &encoded)?;
    read_palette(&path)
}

#[tauri::command]
fn delete_palette(id: String) -> Result<(), String> {
    if !valid_palette_id(&id) || is_built_in_palette_id(&id) {
        return Err("内置色板不能删除。".to_string());
    }
    let path = palette_dir()?.join(format!("{id}.palette.json"));
    if !path.exists() {
        return Err("色板文件不存在。".to_string());
    }
    fs::remove_file(path).map_err(|error| format!("无法删除色板：{error}"))
}

#[tauri::command]
fn open_palette_folder() -> Result<(), String> {
    let directory = palette_dir()?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("无法打开色板文件夹：{error}"))?;
    Ok(())
}

fn workspace_from_file(
    file: WorkspaceDiskFile,
    file_path: String,
    source: &str,
    built_in: bool,
) -> Result<StoredWorkspace, String> {
    if file.schema_version != 1 {
        return Err(format!(
            "不支持工作区版本 {}：{source}",
            file.schema_version
        ));
    }
    if !valid_palette_id(&file.id) || file.name.trim().is_empty() || !file.layout.is_object() {
        return Err(format!("工作区信息无效：{source}"));
    }
    let initial_layout = file.initial_layout.unwrap_or_else(|| file.layout.clone());
    if !initial_layout.is_object() {
        return Err(format!("工作区初始布局无效：{source}"));
    }
    Ok(StoredWorkspace {
        id: file.id,
        name: file.name,
        file_path,
        updated_at: file.updated_at,
        built_in,
        layout: file.layout,
        initial_layout,
    })
}

fn built_in_workspace() -> StoredWorkspace {
    let layout = serde_json::json!({
        "panelDocks": { "color": "left", "palette": "left", "layers": "right", "preview": "right" },
        "inspectorWidth": 300,
        "leftDockWidth": 280,
        "bottomDockHeight": 180,
        "toolRailSide": "left",
        "previewOpen": true,
        "inspectorLayout": "{\"order\":[\"palette\",\"color\",\"layers\",\"preview\"],\"sizes\":{\"color\":330,\"palette\":620,\"layers\":560,\"preview\":220},\"bottomWidths\":{\"color\":280,\"palette\":280,\"layers\":320,\"preview\":280}}",
        "colorSquareDock": "left",
        "colorSquareAnchor": "end",
        "floatingPanels": { "color": null, "palette": null, "layers": null, "preview": null },
        "mainWindow": null
    });
    StoredWorkspace {
        id: "builtin-default".to_string(),
        name: "默认工作区".to_string(),
        file_path: String::new(),
        updated_at: String::new(),
        built_in: true,
        layout: layout.clone(),
        initial_layout: layout,
    }
}

fn read_workspace(path: &Path) -> Result<StoredWorkspace, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("无法读取工作区 {}：{error}", path.display()))?;
    let file: WorkspaceDiskFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("工作区文件损坏 {}：{error}", path.display()))?;
    workspace_from_file(
        file,
        path.to_string_lossy().to_string(),
        &path.display().to_string(),
        false,
    )
}

fn default_workspace_path(directory: &Path) -> PathBuf {
    directory.join("default.workspace.json")
}

fn read_default_workspace(path: &Path) -> Result<StoredWorkspace, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("无法读取默认工作区 {}：{error}", path.display()))?;
    let file: WorkspaceDiskFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("默认工作区文件损坏 {}：{error}", path.display()))?;
    let mut workspace = workspace_from_file(
        file,
        path.to_string_lossy().to_string(),
        &path.display().to_string(),
        true,
    )?;
    if workspace.id != "builtin-default" {
        return Err("默认工作区 ID 无效。".to_string());
    }
    // The built-in workspace is editable, but keeps its stable user-facing name.
    workspace.name = "默认工作区".to_string();
    Ok(workspace)
}

#[tauri::command]
fn list_workspaces() -> Result<WorkspaceListing, String> {
    let directory = workspace_dir()?;
    let default_path = default_workspace_path(&directory);
    let default_workspace = if default_path.is_file() {
        read_default_workspace(&default_path).unwrap_or_else(|_| built_in_workspace())
    } else {
        built_in_workspace()
    };
    let mut workspaces = vec![default_workspace];
    for entry in
        fs::read_dir(&directory).map_err(|error| format!("无法读取工作区文件夹：{error}"))?
    {
        let path = entry
            .map_err(|error| format!("无法读取工作区文件：{error}"))?
            .path();
        let is_workspace = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.ends_with(".workspace.json"))
            .unwrap_or(false);
        if path.is_file() && is_workspace && path != default_path {
            if let Ok(workspace) = read_workspace(&path) {
                workspaces.push(workspace);
            }
        }
    }
    workspaces.sort_by(|left, right| {
        right
            .built_in
            .cmp(&left.built_in)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(WorkspaceListing {
        directory_path: directory.to_string_lossy().to_string(),
        workspaces,
    })
}

#[tauri::command]
fn save_workspace(
    id: Option<String>,
    name: String,
    layout: serde_json::Value,
) -> Result<StoredWorkspace, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 96 {
        return Err("工作区名称必须为 1 到 96 个字符。".to_string());
    }
    if !layout.is_object() {
        return Err("工作区布局无效。".to_string());
    }
    let layout_size = serde_json::to_vec(&layout)
        .map_err(|error| error.to_string())?
        .len();
    if layout_size > 256 * 1024 {
        return Err("工作区布局过大。".to_string());
    }
    let directory = workspace_dir()?;
    let workspace_id = match id {
        Some(value) if valid_palette_id(&value) => value,
        Some(_) => return Err("工作区 ID 无效。".to_string()),
        None => {
            let base = palette_slug(name).replace("palette-", "workspace-");
            let mut candidate = base.clone();
            let mut suffix = 2;
            while directory
                .join(format!("{candidate}.workspace.json"))
                .exists()
            {
                candidate = format!("{base}-{suffix}");
                suffix += 1;
            }
            candidate
        }
    };
    let built_in = workspace_id == "builtin-default";
    let path = if built_in {
        default_workspace_path(&directory)
    } else {
        directory.join(format!("{workspace_id}.workspace.json"))
    };
    let initial_layout = if path.is_file() {
        let existing: WorkspaceDiskFile =
            serde_json::from_slice(&fs::read(&path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("无法读取现有工作区 {}：{error}", path.display()))?;
        existing.initial_layout.unwrap_or(existing.layout)
    } else if built_in {
        built_in_workspace().initial_layout
    } else {
        layout.clone()
    };
    let file = WorkspaceDiskFile {
        schema_version: 1,
        id: workspace_id,
        name: name.to_string(),
        updated_at: chrono_like_timestamp().to_string(),
        layout,
        initial_layout: Some(initial_layout),
    };
    let encoded = serde_json::to_vec_pretty(&file).map_err(|error| error.to_string())?;
    atomic_write(&path, &encoded)?;
    if built_in {
        read_default_workspace(&path)
    } else {
        read_workspace(&path)
    }
}

#[tauri::command]
fn delete_workspace(id: String) -> Result<(), String> {
    if !valid_palette_id(&id) || id == "builtin-default" {
        return Err("工作区 ID 无效。".to_string());
    }
    let path = workspace_dir()?.join(format!("{id}.workspace.json"));
    if !path.is_file() {
        return Err("工作区文件不存在。".to_string());
    }
    fs::remove_file(path).map_err(|error| format!("无法删除工作区：{error}"))
}

#[tauri::command]
fn open_workspace_folder() -> Result<(), String> {
    let directory = workspace_dir()?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("无法打开工作区文件夹：{error}"))?;
    Ok(())
}

#[tauri::command]
fn list_brushes() -> Result<BrushListing, String> {
    let directory = brush_dir()?;
    let mut brushes = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| format!("无法读取笔刷文件夹：{error}"))?
    {
        let path = entry
            .map_err(|error| format!("无法读取笔刷文件：{error}"))?
            .path();
        let is_png = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("png"))
            .unwrap_or(false);
        if !path.is_file() || !is_png {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("笔刷文件名无效：{}", path.display()))?;
        let name = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name)
            .to_string();
        let metadata_path = path.with_extension("meta.json");
        let metadata = fs::read(&metadata_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<BrushMetadata>(&bytes).ok())
            .unwrap_or_default();
        brushes.push(StoredBrush {
            id: file_name.to_string(),
            name,
            file_path: path.to_string_lossy().to_string(),
            intrinsic_size: metadata.intrinsic_size,
            source_x: metadata.source_x,
            source_y: metadata.source_y,
        });
    }
    brushes.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(BrushListing {
        directory_path: directory.to_string_lossy().to_string(),
        brushes,
    })
}

fn safe_brush_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.contains(['/', '\\'])
        || id.contains("..")
        || !id.to_ascii_lowercase().ends_with(".png")
    {
        return Err("无效的笔刷文件 ID。".to_string());
    }
    Ok(id)
}

#[tauri::command]
fn save_brush(
    name: String,
    data: Vec<u8>,
    intrinsic_size: Option<bool>,
    source_x: Option<i32>,
    source_y: Option<i32>,
) -> Result<StoredBrush, String> {
    let directory = brush_dir()?;
    let clean_name: String = name
        .trim()
        .chars()
        .filter(|character| !['/', '\\', ':', '*', '?', '"', '<', '>', '|'].contains(character))
        .collect();
    let clean_name = if clean_name.trim().is_empty() {
        "选区笔刷"
    } else {
        clean_name.trim()
    };
    let file_name = format!("{}-{}.png", clean_name, uuid_suffix());
    let path = directory.join(&file_name);
    atomic_write(&path, &data)?;
    let metadata_path = path.with_extension("meta.json");
    let metadata = serde_json::to_vec(&BrushMetadata {
        intrinsic_size: intrinsic_size.unwrap_or(false),
        source_x,
        source_y,
    })
    .map_err(|error| format!("无法保存笔刷元数据：{error}"))?;
    atomic_write(&metadata_path, &metadata)?;
    Ok(StoredBrush {
        id: file_name,
        name: clean_name.to_string(),
        file_path: path.to_string_lossy().to_string(),
        intrinsic_size: intrinsic_size.unwrap_or(false),
        source_x,
        source_y,
    })
}

#[tauri::command]
fn delete_brush(id: String) -> Result<(), String> {
    let id = safe_brush_id(&id)?;
    let path = brush_dir()?.join(id);
    if !path.exists() {
        return Err("笔刷文件不存在。".to_string());
    }
    let metadata_path = path.with_extension("meta.json");
    fs::remove_file(&path).map_err(|error| format!("无法删除笔刷：{error}"))?;
    let _ = fs::remove_file(metadata_path);
    Ok(())
}

#[tauri::command]
fn open_brush_folder() -> Result<(), String> {
    let directory = brush_dir()?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("无法打开笔刷文件夹：{error}"))?;
    Ok(())
}

#[tauri::command]
fn read_binary(file_path: String) -> Result<Vec<u8>, String> {
    fs::read(file_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_binary_atomic(file_path: String, data: Vec<u8>) -> Result<(), String> {
    atomic_write(Path::new(&file_path), &data)
}

fn clipboard_image_bytes(width: usize, height: usize) -> Result<usize, String> {
    let pixels = width
        .checked_mul(height)
        .ok_or_else(|| "剪贴板图像尺寸过大。".to_string())?;
    let bytes = pixels
        .checked_mul(4)
        .ok_or_else(|| "剪贴板图像尺寸过大。".to_string())?;
    if width == 0 || height == 0 || bytes > 64 * 1024 * 1024 {
        return Err("剪贴板图像尺寸无效或超过 64 MiB 限制。".to_string());
    }
    Ok(bytes)
}

#[tauri::command]
fn write_clipboard_image(width: usize, height: usize, data: Vec<u8>) -> Result<(), String> {
    let expected = clipboard_image_bytes(width, height)?;
    if data.len() != expected {
        return Err("剪贴板图像像素数据长度无效。".to_string());
    }
    let mut clipboard = Clipboard::new().map_err(|error| format!("无法访问系统剪贴板：{error}"))?;
    clipboard
        .set_image(ImageData {
            width,
            height,
            bytes: Cow::Owned(data),
        })
        .map_err(|error| format!("无法写入系统剪贴板：{error}"))
}

#[tauri::command]
fn read_clipboard_image() -> Result<Option<ClipboardImage>, String> {
    let mut clipboard = Clipboard::new().map_err(|error| format!("无法访问系统剪贴板：{error}"))?;
    match clipboard.get_image() {
        Ok(image) => {
            let expected = clipboard_image_bytes(image.width, image.height)?;
            if image.bytes.len() != expected {
                return Err("系统剪贴板图像数据无效。".to_string());
            }
            Ok(Some(ClipboardImage {
                width: image.width,
                height: image.height,
                data: image.bytes.into_owned(),
            }))
        }
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(error) => Err(format!("无法读取系统剪贴板图像：{error}")),
    }
}

#[tauri::command]
fn get_resource_info() -> (u64, u64) {
    let mut system = System::new();
    system.refresh_memory();
    (system.total_memory(), system.available_memory())
}

#[tauri::command]
fn list_recoveries(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<RecoveryRecord>, String> {
    if !*state
        .previous_session_crashed
        .lock()
        .map_err(|_| "恢复状态锁不可用")?
    {
        return Ok(Vec::new());
    }
    let directory = recovery_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(value) = fs::read_to_string(path) {
            if let Ok(record) = serde_json::from_str::<RecoveryRecord>(&value) {
                records.push(record);
            }
        }
    }
    records.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(records)
}

#[tauri::command]
fn read_recovery(app: AppHandle, id: String) -> Result<Vec<u8>, String> {
    let id = safe_recovery_id(&id)?;
    fs::read(recovery_dir(&app)?.join(format!("{id}.moonsprite")))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn write_recovery(app: AppHandle, id: String, name: String, data: Vec<u8>) -> Result<(), String> {
    let id = safe_recovery_id(&id)?;
    let directory = recovery_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    atomic_write(&directory.join(format!("{id}.moonsprite")), &data)?;
    let record = RecoveryRecord {
        id: id.to_string(),
        name,
        updated_at: unix_timestamp_millis().to_string(),
    };
    atomic_write(
        &directory.join(format!("{id}.json")),
        serde_json::to_string(&record)
            .map_err(|error| error.to_string())?
            .as_bytes(),
    )
}

#[tauri::command]
fn delete_recovery(app: AppHandle, id: String) -> Result<(), String> {
    let id = safe_recovery_id(&id)?;
    let directory = recovery_dir(&app)?;
    let _ = fs::remove_file(directory.join(format!("{id}.moonsprite")));
    let _ = fs::remove_file(directory.join(format!("{id}.json")));
    Ok(())
}

#[tauri::command]
fn list_gallery_projects() -> Result<GalleryListing, String> {
    let directory = gallery_dir()?;
    let mut projects = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| format!("无法读取图库：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取图库项目：{error}"))?;
        let path = entry.path();
        if !path.is_file()
            || path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| !value.eq_ignore_ascii_case("moonsprite"))
                .unwrap_or(true)
        {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("无法读取工程信息 {}：{error}", path.display()))?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or_default();
        let file_name = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名工程")
            .to_string();
        projects.push(GalleryProject {
            file_path: path.to_string_lossy().to_string(),
            file_name,
            modified_at,
        });
    }
    projects.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    Ok(GalleryListing {
        directory_path: directory.to_string_lossy().to_string(),
        projects,
    })
}

#[tauri::command]
fn delete_gallery_project(app: AppHandle, file_name: String) -> Result<(), String> {
    if file_name.is_empty()
        || Path::new(&file_name)
            .file_name()
            .and_then(|value| value.to_str())
            != Some(file_name.as_str())
        || !file_name.to_ascii_lowercase().ends_with(".moonsprite")
    {
        return Err("无效的画廊工程文件名。".to_string());
    }
    let path = gallery_dir()?.join(&file_name);
    if !path.is_file() {
        return Err("画廊工程文件不存在。".to_string());
    }
    fs::remove_file(&path).map_err(|error| format!("无法删除画廊工程：{error}"))?;
    if file_name == BUILTIN_EXAMPLE_FILE_NAME {
        let _ = atomic_write(
            &builtin_example_marker(&app)?,
            BUILTIN_EXAMPLE_DELETED.as_bytes(),
        );
    }
    Ok(())
}

#[tauri::command]
fn open_gallery_folder() -> Result<(), String> {
    let directory = gallery_dir()?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("无法打开图库文件夹：{error}"))?;
    Ok(())
}

#[tauri::command]
fn open_project_in_folder(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.is_file() {
        return Err("工程文件不存在，无法打开所在文件夹。".to_string());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "无法确定工程文件所在文件夹。".to_string())?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("无法打开工程文件夹：{error}"))?;
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("仅允许打开 HTTP 或 HTTPS 链接。".to_string());
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = std::process::Command::new("rundll32.exe");
        value.arg("url.dll,FileProtocolHandler");
        value
    };
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(url)
        .spawn()
        .map_err(|error| format!("无法打开作者链接：{error}"))?;
    Ok(())
}

#[tauri::command]
fn cancel_close(state: State<'_, AppState>) {
    state.close_requests.cancel();
}

#[tauri::command]
fn approve_close(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.close_requests.cancel();
    mark_session(&app, true)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn confirm_unsaved(_name: String) -> String {
    "cancel".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_files = startup_file_paths();
    tauri::Builder::default()
        .manage(AppState {
            startup_files: Mutex::new(startup_files),
            ..AppState::default()
        })
        .setup(|app| {
            let state = app.state::<AppState>();
            initialize_session_marker(app.handle(), &state)?;
            let _ = ensure_builtin_example(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_files,
            take_startup_files,
            save_project,
            export_image,
            save_palette_image,
            read_binary,
            write_binary_atomic,
            write_clipboard_image,
            read_clipboard_image,
            get_resource_info,
            list_palettes,
            save_palette,
            delete_palette,
            open_palette_folder,
            list_workspaces,
            save_workspace,
            delete_workspace,
            open_workspace_folder,
            list_brushes,
            save_brush,
            delete_brush,
            open_brush_folder,
            list_recoveries,
            read_recovery,
            write_recovery,
            delete_recovery,
            list_gallery_projects,
            delete_gallery_project,
            open_gallery_folder,
            ensure_builtin_example,
            open_project_in_folder,
            open_external_url,
            cancel_close,
            approve_close,
            confirm_unsaved
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let dropped_paths = paths
                    .iter()
                    .map(|path| path.to_string_lossy().to_string())
                    .collect::<Vec<_>>();
                let _ = window.emit("app:file-drop", dropped_paths);
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let pending = window.state::<AppState>().close_requests.clone();
                let Some(generation) = pending.begin() else {
                    return;
                };
                let _ = window.emit("app:request-close", ());
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(12));
                    if pending.expire(generation) {
                        app.exit(1);
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MoonSprite");
}
