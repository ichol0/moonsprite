use rfd::FileDialog;
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::platform_gallery::gallery_dir;

pub type DialogFilter = (&'static str, &'static [&'static str]);

const MOONSPRITE: &[&str] = &["moonsprite"];
const PNG: &[&str] = &["png"];
const JPEG: &[&str] = &["jpg", "jpeg"];
const WEBP: &[&str] = &["webp"];
const ASE: &[&str] = &["ase"];
const ASEPRITE: &[&str] = &["aseprite"];
const ASE_EXPORT: &[&str] = &["ase", "aseprite"];
const SVG: &[&str] = &["svg"];

pub fn project_save_filter(format: Option<&str>) -> DialogFilter {
    match format {
        Some("png") => ("PNG 图片", PNG),
        Some("jpeg") => ("JPEG 图片", JPEG),
        Some("webp") => ("WebP 图片", WEBP),
        Some("ase") => ("Aseprite 工程 (.ase)", ASE),
        Some("aseprite") => ("Aseprite 工程 (.aseprite)", ASEPRITE),
        _ => ("MoonSprite 工程", MOONSPRITE),
    }
}

pub fn image_export_filter(format: &str) -> DialogFilter {
    match format {
        "jpeg" => ("JPEG 图片", JPEG),
        "webp" => ("WebP 图片", WEBP),
        "svg" => ("SVG 图片", SVG),
        "aseprite" => ("Aseprite 工程", ASE_EXPORT),
        _ => ("PNG 图片", PNG),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenDialogResult {
    canceled: bool,
    file_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDialogResult {
    canceled: bool,
    file_path: Option<String>,
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
pub(crate) fn open_files() -> OpenDialogResult {
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
pub(crate) fn save_project(
    default_path: Option<String>,
    format: Option<String>,
) -> SaveDialogResult {
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
pub(crate) fn export_image(default_path: Option<String>, format: String) -> SaveDialogResult {
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
pub(crate) fn save_palette_image(default_path: Option<String>) -> SaveDialogResult {
    let path = file_dialog(default_path.as_deref())
        .add_filter("PNG 色板图像", &["png"])
        .save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{image_export_filter, project_save_filter};

    #[test]
    fn project_save_filters_keep_moonsprite_and_aseprite_distinct() {
        assert_eq!(
            project_save_filter(None),
            ("MoonSprite 工程", &["moonsprite"][..])
        );
        assert_eq!(
            project_save_filter(Some("ase")),
            ("Aseprite 工程 (.ase)", &["ase"][..])
        );
        assert_eq!(
            project_save_filter(Some("aseprite")),
            ("Aseprite 工程 (.aseprite)", &["aseprite"][..])
        );
    }

    #[test]
    fn image_export_filter_supports_svg_and_both_aseprite_suffixes() {
        assert_eq!(image_export_filter("svg"), ("SVG 图片", &["svg"][..]));
        assert_eq!(
            image_export_filter("aseprite"),
            ("Aseprite 工程", &["ase", "aseprite"][..])
        );
    }
}
