use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::platform_paths::ensure_executable_subdirectory;
use crate::platform_storage::atomic_write;

const PRESET_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
const BUILTIN_SEED_MARKER: &str = ".moonsprite-background-presets";
const BUILTIN_PRESETS: &[(&str, &[u8])] = &[
    (
        "grid.png",
        include_bytes!("../resources/background-presets/grid.png"),
    ),
    (
        "stripes.png",
        include_bytes!("../resources/background-presets/stripes.png"),
    ),
    (
        "diamond.png",
        include_bytes!("../resources/background-presets/diamond.png"),
    ),
    (
        "diamond-nested.png",
        include_bytes!("../resources/background-presets/diamond-nested.png"),
    ),
    (
        "circles.png",
        include_bytes!("../resources/background-presets/circles.png"),
    ),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredBackgroundPreset {
    id: String,
    name: String,
    file_path: String,
    built_in: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackgroundPresetListing {
    directory_path: String,
    presets: Vec<StoredBackgroundPreset>,
}

fn preset_dir() -> Result<PathBuf, String> {
    let directory = ensure_executable_subdirectory("BackgroundPresets", "背景图层预设")?;
    seed_builtin_presets(&directory)?;
    Ok(directory)
}

fn seed_builtin_presets(directory: &Path) -> Result<(), String> {
    let marker = directory.join(BUILTIN_SEED_MARKER);
    if marker.is_file() {
        return Ok(());
    }
    for (name, bytes) in BUILTIN_PRESETS {
        let destination = directory.join(name);
        if !destination.exists() {
            atomic_write(&destination, bytes)?;
        }
    }
    atomic_write(&marker, b"1")
}

fn is_preset_file(path: &Path) -> bool {
    path.is_file()
        && path
            .metadata()
            .map(|metadata| metadata.len() <= 32 * 1024 * 1024)
            .unwrap_or(false)
        && path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                PRESET_EXTENSIONS
                    .iter()
                    .any(|extension| value.eq_ignore_ascii_case(extension))
            })
}

fn readable_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Background preset")
        .replace('-', " ")
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn built_in_order(id: &str) -> usize {
    BUILTIN_PRESETS
        .iter()
        .position(|(name, _)| *name == id)
        .unwrap_or(usize::MAX)
}

pub(crate) fn ensure_background_preset_folder() -> Result<PathBuf, String> {
    preset_dir()
}

#[tauri::command]
pub(crate) fn list_background_presets() -> Result<BackgroundPresetListing, String> {
    let directory = preset_dir()?;
    let mut presets = fs::read_dir(&directory)
        .map_err(|error| format!("无法读取背景图层预设文件夹：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_preset_file(path))
        .filter_map(|path| {
            let id = path.file_name()?.to_str()?.to_string();
            Some(StoredBackgroundPreset {
                name: readable_name(&path),
                file_path: path.to_string_lossy().to_string(),
                built_in: built_in_order(&id) != usize::MAX,
                id,
            })
        })
        .collect::<Vec<_>>();
    presets.sort_by(|left, right| {
        built_in_order(&left.id)
            .cmp(&built_in_order(&right.id))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(BackgroundPresetListing {
        directory_path: directory.to_string_lossy().to_string(),
        presets,
    })
}

#[tauri::command]
pub(crate) fn open_background_preset_folder() -> Result<(), String> {
    let directory = preset_dir()?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("无法打开背景图层预设文件夹：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{seed_builtin_presets, BUILTIN_PRESETS, BUILTIN_SEED_MARKER};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn seeds_once_and_respects_user_deletions() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("moonsprite-background-presets-{stamp}"));
        fs::create_dir_all(&directory).unwrap();

        seed_builtin_presets(&directory).unwrap();
        assert!(BUILTIN_PRESETS
            .iter()
            .all(|(name, _)| directory.join(name).is_file()));
        assert!(directory.join(BUILTIN_SEED_MARKER).is_file());

        let deleted = directory.join(BUILTIN_PRESETS[0].0);
        fs::remove_file(&deleted).unwrap();
        seed_builtin_presets(&directory).unwrap();
        assert!(!deleted.exists());

        let _ = fs::remove_dir_all(directory);
    }
}
