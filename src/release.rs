use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::{
    config::ProjectConfig,
    models::{AgentOutput, Message},
    store::Store,
};

pub async fn publish(
    config: &ProjectConfig,
    store: &Store,
    agent: &str,
    message: &Message,
    output: &AgentOutput,
) -> Result<bool> {
    if config.producer.is_none() || !output.messages.is_empty() || message.sender == "human" {
        return Ok(false);
    }
    let Some(deliverable) = &output.deliverable else {
        return Ok(false);
    };
    write(config, store, agent, message, deliverable).await
}

async fn write(
    config: &ProjectConfig,
    store: &Store,
    agent: &str,
    message: &Message,
    content: &str,
) -> Result<bool> {
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    let relative = PathBuf::from("releases").join(format!("{hash}.md"));
    let path = config.root.join(&relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if !matches_hash(&path, &hash)? {
        atomic_write(&path, content)?;
    }

    fn matches_hash(path: &Path, expected: &str) -> Result<bool> {
        if !path.exists() {
            return Ok(false);
        }
        let content = std::fs::read(path)?;
        Ok(blake3::hash(&content).to_hex().as_str() == expected)
    }

    fn atomic_write(path: &Path, content: &str) -> Result<()> {
        let temp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
        std::fs::write(&temp, content)?;
        if let Err(error) = replace(&temp, path) {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
        Ok(())
    }

    #[cfg(not(windows))]
    fn replace(source: &Path, destination: &Path) -> Result<()> {
        std::fs::rename(source, destination)?;
        Ok(())
    }

    #[cfg(windows)]
    fn replace(source: &Path, destination: &Path) -> Result<()> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }
    store
        .add_release(
            &hash,
            agent,
            &message.topic,
            content,
            &relative.to_string_lossy().replace('\\', "/"),
        )
        .await
}
