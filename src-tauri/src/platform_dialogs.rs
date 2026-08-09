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
const GIF: &[&str] = &["gif"];
const MP4: &[&str] = &["mp4"];
const WEBM: &[&str] = &["webm"];
const JSON: &[&str] = &["json"];

fn is_english(language: Option<&str>) -> bool {
    language == Some("en-US")
}

pub fn project_save_filter(format: Option<&str>, language: Option<&str>) -> DialogFilter {
    match (format, is_english(language)) {
        (Some("png"), true) => ("PNG image", PNG),
        (Some("jpeg"), true) => ("JPEG image", JPEG),
        (Some("webp"), true) => ("WebP image", WEBP),
        (Some("ase"), true) => ("Aseprite project (.ase)", ASE),
        (Some("aseprite"), true) => ("Aseprite project (.aseprite)", ASEPRITE),
        (_, true) => ("MoonSprite project", MOONSPRITE),
        (Some("png"), false) => ("PNG 图片", PNG),
        (Some("jpeg"), false) => ("JPEG 图片", JPEG),
        (Some("webp"), false) => ("WebP 图片", WEBP),
        (Some("ase"), false) => ("Aseprite 工程 (.ase)", ASE),
        (Some("aseprite"), false) => ("Aseprite 工程 (.aseprite)", ASEPRITE),
        _ => ("MoonSprite 工程", MOONSPRITE),
    }
}

pub fn image_export_filter(format: &str, language: Option<&str>) -> DialogFilter {
    if format == "mp4" {
        return (
            if is_english(language) {
                "MP4 video"
            } else {
                "MP4 视频"
            },
            MP4,
        );
    }
    if format == "webm" {
        return (
            if is_english(language) {
                "WebM video"
            } else {
                "WebM 视频"
            },
            WEBM,
        );
    }
    if format == "gif" {
        return (
            if is_english(language) {
                "GIF animation"
            } else {
                "GIF 动画"
            },
            GIF,
        );
    }
    match (format, is_english(language)) {
        ("jpeg", true) => ("JPEG image", JPEG),
        ("webp", true) => ("WebP image", WEBP),
        ("svg", true) => ("SVG image", SVG),
        ("gif", true) => ("GIF animation", GIF),
        ("aseprite", true) => ("Aseprite project", ASE_EXPORT),
        (_, true) => ("PNG image", PNG),
        ("jpeg", false) => ("JPEG 图片", JPEG),
        ("webp", false) => ("WebP 图片", WEBP),
        ("svg", false) => ("SVG 图片", SVG),
        ("aseprite", false) => ("Aseprite 工程", ASE_EXPORT),
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
pub(crate) fn open_files(language: Option<String>) -> OpenDialogResult {
    let english = is_english(language.as_deref());
    let paths = FileDialog::new()
        .add_filter(
            if english {
                "All supported files"
            } else {
                "所有支持的文件"
            },
            &[
                "moonsprite",
                "ase",
                "aseprite",
                "png",
                "jpg",
                "jpeg",
                "webp",
                "bmp",
                "gif",
            ],
        )
        .add_filter("Aseprite files", &["ase", "aseprite"])
        .add_filter(
            if english {
                "MoonSprite project"
            } else {
                "MoonSprite 工程"
            },
            &["moonsprite"],
        )
        .add_filter(
            if english { "Images" } else { "图片" },
            &["png", "jpg", "jpeg", "webp", "bmp", "gif"],
        )
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
    language: Option<String>,
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
    let (label, extensions) = project_save_filter(format.as_deref(), language.as_deref());
    let path = dialog.add_filter(label, &extensions).save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub(crate) fn export_image(
    default_path: Option<String>,
    format: String,
    language: Option<String>,
) -> SaveDialogResult {
    let (label, extensions) = image_export_filter(&format, language.as_deref());
    let path = file_dialog(default_path.as_deref())
        .add_filter(label, &extensions)
        .save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub(crate) fn save_palette_image(
    default_path: Option<String>,
    language: Option<String>,
) -> SaveDialogResult {
    let path = file_dialog(default_path.as_deref())
        .add_filter(
            if is_english(language.as_deref()) {
                "PNG palette image"
            } else {
                "PNG 色板图像"
            },
            &["png"],
        )
        .save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub(crate) fn save_shortcut_file(
    default_path: Option<String>,
    language: Option<String>,
) -> SaveDialogResult {
    let path = file_dialog(default_path.as_deref())
        .add_filter(
            if is_english(language.as_deref()) {
                "MoonSprite shortcut settings"
            } else {
                "MoonSprite 快捷键设置"
            },
            JSON,
        )
        .save_file();
    SaveDialogResult {
        canceled: path.is_none(),
        file_path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub(crate) fn save_theme_file(
    default_path: Option<String>,
    language: Option<String>,
) -> SaveDialogResult {
    let path = file_dialog(default_path.as_deref())
        .add_filter(
            if is_english(language.as_deref()) {
                "MoonSprite theme"
            } else {
                "MoonSprite 主题"
            },
            JSON,
        )
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
            project_save_filter(None, None),
            ("MoonSprite 工程", &["moonsprite"][..])
        );
        assert_eq!(
            project_save_filter(Some("ase"), None),
            ("Aseprite 工程 (.ase)", &["ase"][..])
        );
        assert_eq!(
            project_save_filter(Some("aseprite"), None),
            ("Aseprite 工程 (.aseprite)", &["aseprite"][..])
        );
    }

    #[test]
    fn image_export_filter_supports_svg_and_both_aseprite_suffixes() {
        assert_eq!(image_export_filter("svg", None), ("SVG 图片", &["svg"][..]));
        assert_eq!(image_export_filter("gif", None), ("GIF 动画", &["gif"][..]));
        assert_eq!(
            image_export_filter("aseprite", None),
            ("Aseprite 工程", &["ase", "aseprite"][..])
        );
    }

    #[test]
    fn dialog_filters_follow_the_selected_english_locale() {
        assert_eq!(
            project_save_filter(None, Some("en-US")),
            ("MoonSprite project", &["moonsprite"][..])
        );
        assert_eq!(
            project_save_filter(Some("aseprite"), Some("en-US")),
            ("Aseprite project (.aseprite)", &["aseprite"][..])
        );
        assert_eq!(
            image_export_filter("svg", Some("en-US")),
            ("SVG image", &["svg"][..])
        );
    }
}
