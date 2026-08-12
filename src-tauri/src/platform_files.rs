use crate::platform_storage::{atomic_write, atomic_write_with};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, hash::{Hash, Hasher}, io::{Cursor, Read, Seek, Write}, path::{Path, PathBuf}, time::UNIX_EPOCH};
use tauri::{ipc::{Channel, InvokeBody, Request, Response}, AppHandle, Manager};

const FILE_PATH_HEADER: &str = "x-moonsprite-file-path";
const SOURCE_PATH_HEADER: &str = "x-moonsprite-source-path";
const SAVE_PLAN_ENTRY: &str = ".moonsprite-save-plan.json";

#[derive(Debug, Deserialize)]
struct ProjectSaveReuseEntry {
    path: String,
    crc32: u32,
}

#[derive(Debug, Deserialize)]
struct ProjectSavePlan {
    version: u8,
    entries: Vec<ProjectSaveReuseEntry>,
}

fn decode_file_path_header(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err("Invalid encoded file path.".to_string());
        }
        let hex = |byte: u8| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        };
        let high = hex(bytes[index + 1]).ok_or_else(|| "Invalid encoded file path.".to_string())?;
        let low = hex(bytes[index + 2]).ok_or_else(|| "Invalid encoded file path.".to_string())?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).map_err(|_| "Invalid encoded file path.".to_string())
}

fn request_path(request: &Request<'_>, header: &str) -> Result<String, String> {
    let encoded = request
        .headers()
        .get(header)
        .ok_or_else(|| "Missing file path.".to_string())?
        .to_str()
        .map_err(|_| "Invalid encoded file path.".to_string())?;
    decode_file_path_header(encoded)
}

fn raw_request_data<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(data) => Ok(data),
        InvokeBody::Json(_) => Err("Binary file data is required.".to_string()),
    }
}

fn merge_project_archive<R: Read + Seek, W: Write + Seek>(source: R, patch: &[u8], output: W) -> Result<(), String> {
    let mut source_archive = zip::ZipArchive::new(source).map_err(|error| error.to_string())?;
    let mut patch_archive = zip::ZipArchive::new(Cursor::new(patch)).map_err(|error| error.to_string())?;
    let plan = {
        let mut entry = patch_archive.by_name(SAVE_PLAN_ENTRY).map_err(|error| error.to_string())?;
        let mut bytes = Vec::with_capacity(entry.size().min(1024 * 1024) as usize);
        entry.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        serde_json::from_slice::<ProjectSavePlan>(&bytes).map_err(|error| error.to_string())?
    };
    if plan.version != 1 || plan.entries.is_empty() {
        return Err("Invalid incremental save plan.".to_string());
    }
    let mut names = HashSet::new();
    for entry in &plan.entries {
        if entry.path.is_empty() || entry.path == SAVE_PLAN_ENTRY || !names.insert(entry.path.clone()) {
            return Err("Invalid incremental save entry.".to_string());
        }
    }
    let mut writer = zip::ZipWriter::new(output);
    for index in 0..patch_archive.len() {
        let entry = patch_archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.name() == SAVE_PLAN_ENTRY {
            continue;
        }
        if names.contains(entry.name()) {
            return Err("Incremental save entry conflicts with patch data.".to_string());
        }
        writer.raw_copy_file(entry).map_err(|error| error.to_string())?;
    }
    for reuse in plan.entries {
        let entry = source_archive.by_name(&reuse.path).map_err(|error| error.to_string())?;
        if entry.crc32() != reuse.crc32 {
            return Err("Incremental save source changed.".to_string());
        }
        writer.raw_copy_file(entry).map_err(|error| error.to_string())?;
    }
    writer.finish().map(|_| ()).map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPreview {
    preview: Vec<u8>,
    width: u32,
    height: u32,
    color_mode: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryReadProgress {
    bytes_read: u64,
    total_bytes: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectPreviewCacheMetadata {
    source_size: u64,
    source_modified_at: u64,
    width: u32,
    height: u32,
    color_mode: String,
}

fn project_preview_cache_paths(app: &AppHandle, file_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    file_path.to_lowercase().hash(&mut hasher);
    let directory = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("project-previews");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let key = format!("{:016x}", hasher.finish());
    Ok((directory.join(format!("{key}.json")), directory.join(format!("{key}.png"))))
}

fn source_fingerprint(path: &Path) -> Result<(u64, u64), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_at = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_millis().min(u64::MAX as u128) as u64).unwrap_or_default();
    Ok((metadata.len(), modified_at))
}

fn write_project_preview_cache(app: &AppHandle, file_path: &str, preview: &[u8], width: u32, height: u32, color_mode: &str) -> Result<(), String> {
    if preview.is_empty() || width == 0 || height == 0 || !matches!(color_mode, "rgba" | "indexed") {
        return Err("工程缩略图数据无效。".to_string());
    }
    let path = Path::new(file_path);
    let (source_size, source_modified_at) = source_fingerprint(path)?;
    let (cache_metadata_path, cache_preview_path) = project_preview_cache_paths(app, file_path)?;
    let cache = ProjectPreviewCacheMetadata { source_size, source_modified_at, width, height, color_mode: color_mode.to_string() };
    let metadata = serde_json::to_vec(&cache).map_err(|error| error.to_string())?;
    atomic_write(&cache_preview_path, preview)?;
    atomic_write(&cache_metadata_path, &metadata)
}

#[tauri::command]
pub fn file_exists(file_path: String) -> bool {
    Path::new(&file_path).is_file()
}

#[tauri::command]
pub fn read_binary(file_path: String, on_progress: Channel<BinaryReadProgress>) -> Result<Response, String> {
    let mut file = fs::File::open(&file_path).map_err(|error| error.to_string())?;
    let total_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    let capacity = usize::try_from(total_bytes).unwrap_or(0);
    let mut output = Vec::with_capacity(capacity);
    let mut chunk = vec![0_u8; 256 * 1024];
    let mut bytes_read = 0_u64;
    let _ = on_progress.send(BinaryReadProgress { bytes_read, total_bytes });
    loop {
        let count = file.read(&mut chunk).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        output.extend_from_slice(&chunk[..count]);
        bytes_read = bytes_read.saturating_add(count as u64);
        let _ = on_progress.send(BinaryReadProgress { bytes_read, total_bytes });
    }
    Ok(Response::new(output))
}

#[tauri::command]
pub fn read_project_preview(app: AppHandle, file_path: String) -> Result<ProjectPreview, String> {
    let path = Path::new(&file_path);
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("moonsprite"))
    {
        return Err("仅 MoonSprite 工程包含内嵌缩略图。".to_string());
    }
    let (source_size, source_modified_at) = source_fingerprint(path)?;
    let (cache_metadata_path, cache_preview_path) = project_preview_cache_paths(&app, &file_path)?;
    if let Ok(cache_metadata_bytes) = fs::read(&cache_metadata_path) {
        if let Ok(cache) = serde_json::from_slice::<ProjectPreviewCacheMetadata>(&cache_metadata_bytes) {
            if cache.source_size == source_size && cache.source_modified_at == source_modified_at {
                if let Ok(preview) = fs::read(&cache_preview_path) {
                    if !preview.is_empty() {
                        return Ok(ProjectPreview { preview, width: cache.width, height: cache.height, color_mode: cache.color_mode });
                    }
                }
            }
        }
    }
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let manifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|error| format!("无法读取工程清单：{error}"))?;
        let mut bytes = Vec::with_capacity(entry.size().min(256 * 1024) as usize);
        entry.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|error| error.to_string())?
    };
    let document = manifest
        .get("document")
        .ok_or_else(|| "工程清单缺少文档信息。".to_string())?;
    let width = document.get("width").and_then(|value| value.as_u64()).and_then(|value| u32::try_from(value).ok()).ok_or_else(|| "工程宽度无效。".to_string())?;
    let height = document.get("height").and_then(|value| value.as_u64()).and_then(|value| u32::try_from(value).ok()).ok_or_else(|| "工程高度无效。".to_string())?;
    let color_mode = document.get("colorMode").and_then(|value| value.as_str()).filter(|value| matches!(*value, "rgba" | "indexed")).ok_or_else(|| "工程颜色模式无效。".to_string())?.to_string();
    let preview = {
        let mut entry = archive
            .by_name("preview.png")
            .map_err(|error| format!("无法读取工程缩略图：{error}"))?;
        let mut bytes = Vec::with_capacity(entry.size().min(4 * 1024 * 1024) as usize);
        entry.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        bytes
    };
    if preview.is_empty() {
        return Err("工程缩略图为空。".to_string());
    }
    let _ = write_project_preview_cache(&app, &file_path, &preview, width, height, &color_mode);
    Ok(ProjectPreview { preview, width, height, color_mode })
}

#[tauri::command]
pub fn cache_project_preview(app: AppHandle, file_path: String, preview: Vec<u8>, width: u32, height: u32, color_mode: String) -> Result<(), String> {
    if !Path::new(&file_path)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("moonsprite"))
    {
        return Err("仅 MoonSprite 工程支持缩略图缓存。".to_string());
    }
    write_project_preview_cache(&app, &file_path, &preview, width, height, &color_mode)
}

#[tauri::command]
pub fn write_binary_atomic(request: Request<'_>) -> Result<(), String> {
    let file_path = request_path(&request, FILE_PATH_HEADER)?;
    let data = raw_request_data(&request)?;
    atomic_write(Path::new(&file_path), data)
}

#[tauri::command]
pub fn write_project_incremental(request: Request<'_>) -> Result<(), String> {
    let file_path = request_path(&request, FILE_PATH_HEADER)?;
    let source_path = request_path(&request, SOURCE_PATH_HEADER)?;
    let patch = raw_request_data(&request)?;
    let source = fs::File::open(&source_path).map_err(|error| error.to_string())?;
    atomic_write_with(Path::new(&file_path), |output| merge_project_archive(source, patch, output))
}

#[cfg(test)]
mod tests {
    use super::{decode_file_path_header, merge_project_archive, SAVE_PLAN_ENTRY};
    use std::io::{Cursor, Read, Write};
    use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            writer.start_file(*name, SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn decodes_unicode_windows_file_paths() {
        assert_eq!(
            decode_file_path_header("D%3A%5CMoonSprite%5C%E5%9B%BE%E6%A0%87.moonsprite").unwrap(),
            "D:\\MoonSprite\\图标.moonsprite"
        );
    }

    #[test]
    fn rejects_invalid_path_encoding() {
        assert!(decode_file_path_header("D%3A%5Cbroken%ZZ").is_err());
        assert!(decode_file_path_header("D%3A%5Cbroken%").is_err());
    }

    #[test]
    fn merges_changed_entries_with_raw_reused_blocks() {
        let source = archive(&[("layers/a.rgba", b"unchanged pixels"), ("manifest.json", b"old")]);
        let crc32 = ZipArchive::new(Cursor::new(&source)).unwrap().by_name("layers/a.rgba").unwrap().crc32();
        let plan = format!(r#"{{"version":1,"entries":[{{"path":"layers/a.rgba","crc32":{crc32}}}]}}"#);
        let patch = archive(&[("manifest.json", b"new"), (SAVE_PLAN_ENTRY, plan.as_bytes())]);

        let mut merged = Cursor::new(Vec::new());
        merge_project_archive(Cursor::new(&source), &patch, &mut merged).unwrap();
        let mut output = ZipArchive::new(Cursor::new(merged.into_inner())).unwrap();
        let mut manifest = String::new();
        output.by_name("manifest.json").unwrap().read_to_string(&mut manifest).unwrap();
        let mut pixels = String::new();
        output.by_name("layers/a.rgba").unwrap().read_to_string(&mut pixels).unwrap();
        assert_eq!(manifest, "new");
        assert_eq!(pixels, "unchanged pixels");
        assert!(output.by_name(SAVE_PLAN_ENTRY).is_err());
    }

    #[test]
    fn rejects_reuse_when_the_source_crc_changed() {
        let source = archive(&[("layers/a.rgba", b"changed externally")]);
        let plan = br#"{"version":1,"entries":[{"path":"layers/a.rgba","crc32":1}]}"#;
        let patch = archive(&[("manifest.json", b"new"), (SAVE_PLAN_ENTRY, plan)]);
        assert!(merge_project_archive(Cursor::new(&source), &patch, Cursor::new(Vec::new())).is_err());
    }
}
