use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::{config::ProjectConfig, store::Store};

pub async fn ingest(config: &ProjectConfig, store: &Store) -> Result<usize> {
    let Some(root) = config.work_path() else {
        return Ok(0);
    };
    let inbox = root.join("inbox");
    let progress = root.join("in-progress");
    std::fs::create_dir_all(&inbox)?;
    std::fs::create_dir_all(&progress)?;
    std::fs::create_dir_all(root.join("done"))?;
    let mut count = 0;
    for entry in std::fs::read_dir(inbox)? {
        let source = entry?.path();
        if !source.is_file() {
            continue;
        }
        let body = std::fs::read_to_string(&source)?;
        if body.trim().is_empty() {
            continue;
        }
        let hash = blake3::hash(body.as_bytes()).to_hex().to_string();
        let target = progress.join(source.file_name().unwrap_or_default());
        if store
            .add_work_item(&relative(config, &target), &hash, config.leader(), &body)
            .await?
        {
            move_file(&source, &target)?;
            count += 1;
        }
    }
    Ok(count)
}

pub async fn complete(config: &ProjectConfig, store: &Store, message_id: &str) -> Result<bool> {
    let Some(path) = store.complete_work(message_id).await? else {
        return Ok(false);
    };
    let source = config.root.join(&path);
    let Some(root) = config.work_path() else {
        return Ok(false);
    };
    let target = root
        .join("done")
        .join(source.file_name().unwrap_or_default());
    if source.exists() {
        move_file(&source, &target)?;
    }
    let relative = relative(config, &target);
    store.set_work_path(message_id, &relative).await?;
    Ok(true)
}

fn relative(config: &ProjectConfig, path: &Path) -> String {
    path.strip_prefix(&config.root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn move_file(source: &Path, target: &PathBuf) -> Result<()> {
    std::fs::rename(source, target)?;
    Ok(())
}
