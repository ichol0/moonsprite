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
