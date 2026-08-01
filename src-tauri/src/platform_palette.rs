use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::platform_paths::ensure_executable_subdirectory;
use crate::platform_storage::atomic_write;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaletteColor {
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
pub(crate) struct StoredPalette {
    id: String,
    name: String,
    file_path: String,
    colors: Vec<PaletteColor>,
    built_in: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaletteListing {
    directory_path: String,
    palettes: Vec<StoredPalette>,
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

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
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
pub(crate) fn list_palettes() -> Result<PaletteListing, String> {
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
pub(crate) fn save_palette(
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
pub(crate) fn delete_palette(id: String) -> Result<(), String> {
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
pub(crate) fn open_palette_folder() -> Result<(), String> {
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
