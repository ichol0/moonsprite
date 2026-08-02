use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

use crate::platform_storage::atomic_write;

#[derive(Default)]
pub(crate) struct RecoveryState {
    previous_session_crashed: Mutex<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryRecord {
    id: String,
    name: String,
    updated_at: String,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("recovery"))
}

fn session_marker(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("session-state.json"))
}

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub(crate) fn mark_session(app: &AppHandle, clean: bool) -> Result<(), String> {
    let payload = serde_json::json!({ "clean": clean, "updatedAt": chrono_like_timestamp() });
    atomic_write(&session_marker(app)?, payload.to_string().as_bytes())
}

pub(crate) fn initialize_session_marker(
    app: &AppHandle,
    state: &RecoveryState,
) -> Result<(), String> {
    migrate_legacy_data(app)?;
    let marker = session_marker(app)?;
    let crashed = fs::read_to_string(marker)
        .ok()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
        .and_then(|value| value.get("clean").and_then(serde_json::Value::as_bool))
        .map(|clean| !clean)
        .unwrap_or(false);
    *state
        .previous_session_crashed
        .lock()
        .map_err(|_| "恢复状态锁不可用")? = crashed;
    mark_session(app, false)
}

fn migrate_legacy_data(app: &AppHandle) -> Result<(), String> {
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return Ok(());
    };
    let legacy = PathBuf::from(roaming).join("moonsprite");
    let current = app_data_dir(app)?;
    if !legacy.exists() || legacy == current {
        return Ok(());
    }
    fs::create_dir_all(&current).map_err(|error| error.to_string())?;
    let legacy_marker = legacy.join("session-state.json");
    let current_marker = current.join("session-state.json");
    if legacy_marker.exists() && !current_marker.exists() {
        fs::copy(legacy_marker, current_marker).map_err(|error| error.to_string())?;
    }
    let legacy_recovery = legacy.join("recovery");
    let current_recovery = current.join("recovery");
    if legacy_recovery.exists() && !current_recovery.exists() {
        fs::create_dir_all(&current_recovery).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(legacy_recovery).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    fs::copy(&path, current_recovery.join(name))
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    Ok(())
}

fn safe_recovery_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || !id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
    {
        return Err("无效的恢复文件 ID".to_string());
    }
    Ok(id)
}

#[tauri::command]
pub(crate) fn list_recoveries(
    app: AppHandle,
    state: State<'_, RecoveryState>,
) -> Result<Vec<RecoveryRecord>, String> {
    if !*state
        .previous_session_crashed
        .lock()
        .map_err(|_| "恢复状态锁不可用")?
    {
        return Ok(Vec::new());
    }
    let directory = recovery_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(value) = fs::read_to_string(path) {
            if let Ok(record) = serde_json::from_str::<RecoveryRecord>(&value) {
                records.push(record);
            }
        }
    }
    records.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(records)
}

#[tauri::command]
pub(crate) fn read_recovery(app: AppHandle, id: String) -> Result<Vec<u8>, String> {
    let id = safe_recovery_id(&id)?;
    fs::read(recovery_dir(&app)?.join(format!("{id}.moonsprite")))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn write_recovery(
    app: AppHandle,
    id: String,
    name: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let id = safe_recovery_id(&id)?;
    let directory = recovery_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    atomic_write(&directory.join(format!("{id}.moonsprite")), &data)?;
    let record = RecoveryRecord {
        id: id.to_string(),
        name,
        updated_at: unix_timestamp_millis().to_string(),
    };
    atomic_write(
        &directory.join(format!("{id}.json")),
        serde_json::to_string(&record)
            .map_err(|error| error.to_string())?
            .as_bytes(),
    )
}

#[tauri::command]
pub(crate) fn delete_recovery(app: AppHandle, id: String) -> Result<(), String> {
    let id = safe_recovery_id(&id)?;
    let directory = recovery_dir(&app)?;
    let _ = fs::remove_file(directory.join(format!("{id}.moonsprite")));
    let _ = fs::remove_file(directory.join(format!("{id}.json")));
    Ok(())
}
