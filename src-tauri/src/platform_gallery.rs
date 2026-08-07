use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use crate::platform_paths::ensure_executable_subdirectory;
use crate::platform_storage::atomic_write;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GalleryProject {
    file_path: String,
    file_name: String,
    modified_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GalleryListing {
    directory_path: String,
    projects: Vec<GalleryProject>,
}

const BUILTIN_EXAMPLE_FILE_NAME: &str = "示例.moonsprite";
const BUILTIN_EXAMPLE: &[u8] = include_bytes!("../resources/示例.moonsprite");
const BUILTIN_EXAMPLE_MARKER_VERSION: &str = "3";
const BUILTIN_EXAMPLE_DELETED: &str = "deleted";

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

pub(crate) fn gallery_dir() -> Result<PathBuf, String> {
    ensure_executable_subdirectory("gallery", "图库")
}

fn builtin_example_marker(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("builtin-example-installed.v1"))
}

#[tauri::command]
pub(crate) fn ensure_builtin_example(app: AppHandle) -> Result<Option<String>, String> {
    let marker = builtin_example_marker(&app)?;
    let example_path = gallery_dir()?.join(BUILTIN_EXAMPLE_FILE_NAME);
    let marker_state = fs::read_to_string(&marker).ok();
    if marker_state.as_deref().map(str::trim) == Some(BUILTIN_EXAMPLE_DELETED) {
        return Ok(None);
    }
    if example_path.is_file()
        && marker_state.as_deref().map(str::trim) == Some(BUILTIN_EXAMPLE_MARKER_VERSION)
    {
        return Ok(Some(example_path.to_string_lossy().to_string()));
    }
    atomic_write(&example_path, BUILTIN_EXAMPLE)
        .map_err(|error| format!("无法安装内置示例工程：{error}"))?;
    atomic_write(&marker, BUILTIN_EXAMPLE_MARKER_VERSION.as_bytes())
        .map_err(|error| format!("无法记录内置示例工程状态：{error}"))?;
    Ok(Some(example_path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn list_gallery_projects() -> Result<GalleryListing, String> {
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
pub(crate) fn delete_gallery_project(app: AppHandle, file_name: String) -> Result<(), String> {
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
pub(crate) fn open_gallery_folder() -> Result<(), String> {
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
pub(crate) fn open_project_in_folder(file_path: String) -> Result<(), String> {
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
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
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
