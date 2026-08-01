use crate::platform_storage::atomic_write;
use std::{fs, path::Path};

#[tauri::command]
pub fn read_binary(file_path: String) -> Result<Vec<u8>, String> {
    fs::read(file_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_binary_atomic(file_path: String, data: Vec<u8>) -> Result<(), String> {
    atomic_write(Path::new(&file_path), &data)
}
