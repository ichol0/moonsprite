use arboard::{Clipboard, ImageData};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    width: usize,
    height: usize,
    data: Vec<u8>,
}

fn image_bytes(width: usize, height: usize) -> Result<usize, String> {
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
pub fn write_clipboard_image(width: usize, height: usize, data: Vec<u8>) -> Result<(), String> {
    let expected = image_bytes(width, height)?;
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
pub fn read_clipboard_image() -> Result<Option<ClipboardImage>, String> {
    let mut clipboard = Clipboard::new().map_err(|error| format!("无法访问系统剪贴板：{error}"))?;
    match clipboard.get_image() {
        Ok(image) => {
            let expected = image_bytes(image.width, image.height)?;
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

#[cfg(test)]
mod tests {
    use super::image_bytes;

    #[test]
    fn validates_rgba_image_size_without_overflow() {
        assert_eq!(image_bytes(2, 3).unwrap(), 24);
        assert!(image_bytes(0, 3).is_err());
        assert!(image_bytes(usize::MAX, 2).is_err());
    }
}
