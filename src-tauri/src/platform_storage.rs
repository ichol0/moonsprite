use std::{
    fs, io,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

fn temporary_suffix() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("{}-{}", std::process::id(), timestamp)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let source_name = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target_name = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source_name.as_ptr(),
            target_name.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
    fs::rename(source, target)
}

/// Writes a file through a sibling temporary file and replaces the target in one operation.
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let temporary = path.with_extension(format!("{}.tmp", temporary_suffix()));
    let result = (|| {
        let mut file = fs::File::create(&temporary)?;
        std::io::Write::write_all(&mut file, data)?;
        file.sync_all()?;
        replace_file(&temporary, path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::atomic_write;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_path(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("moonsprite-platform-storage-{stamp}-{name}"))
    }

    #[test]
    fn writes_and_replaces_without_removing_the_target_first() {
        let path = test_path("replace.bin");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn creates_missing_parent_directories() {
        let path = test_path("nested").join("file.bin");
        atomic_write(&path, b"content").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"content");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
