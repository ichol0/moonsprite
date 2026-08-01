use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

use crate::platform_paths::ensure_executable_subdirectory;
use crate::platform_storage::atomic_write;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredBrush {
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
pub(crate) struct BrushListing {
    directory_path: String,
    brushes: Vec<StoredBrush>,
}

fn brush_dir() -> Result<PathBuf, String> {
    ensure_executable_subdirectory("brushes", "笔刷")
}

fn uuid_suffix() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{timestamp}", std::process::id())
}

#[tauri::command]
pub(crate) fn list_brushes() -> Result<BrushListing, String> {
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
pub(crate) fn save_brush(
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
pub(crate) fn delete_brush(id: String) -> Result<(), String> {
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
pub(crate) fn open_brush_folder() -> Result<(), String> {
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
