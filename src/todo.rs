use std::{fs, path::Path};

use anyhow::Result;

use crate::{config::ProjectConfig, store::Store};

pub async fn ingest(config: &ProjectConfig, store: &Store, leader: &str) -> Result<usize> {
    let todo_dir = config.todo_path();
    fs::create_dir_all(&todo_dir)?;
    let mut paths = fs::read_dir(&todo_dir)?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| path.is_file() && supported(path))
        .collect::<Vec<_>>();
    paths.sort();
    let mut count = 0;
    for path in paths {
        let body = fs::read_to_string(&path)?;
        if body.trim().is_empty() {
            continue;
        }
        let relative = path
            .strip_prefix(&config.root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let hash = blake3::hash(body.as_bytes()).to_hex().to_string();
        if store.ingest_todo(&relative, &hash, leader, &body).await? {
            count += 1;
        }
    }
    Ok(count)
}

fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| matches!(extension, "md" | "txt" | "todo"))
}
