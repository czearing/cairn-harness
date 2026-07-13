use std::{fs, path::Path};

use anyhow::{Result, bail};

use crate::{config::ProjectConfig, store::Store};

pub async fn ingest(config: &ProjectConfig, store: &Store, leader: &str) -> Result<usize> {
    let mut paths = todo_paths(config)?;
    paths.sort();
    let agents: Vec<_> = config
        .workers()
        .into_iter()
        .map(|worker| worker.id)
        .collect();
    let mut count = 0;
    for path in paths {
        let content = fs::read_to_string(&path)?;
        if content.trim().is_empty() {
            continue;
        }
        let relative = relative(config, &path);
        let todo = parse(&content, leader, &relative);
        if !agents.contains(&todo.to) {
            bail!("TODO {} targets unknown agent {}", relative, todo.to);
        }
        let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
        if store
            .ingest_todo(&relative, &hash, &todo.to, &todo.topic, &todo.body)
            .await?
        {
            count += 1;
        }
    }
    Ok(count)
}

pub fn has_route(config: &ProjectConfig, to: &str, topic: &str) -> Result<bool> {
    for path in todo_paths(config)? {
        let content = fs::read_to_string(&path)?;
        let relative = relative(config, &path);
        let todo = parse(&content, config.leader(), &relative);
        if todo.to == to && todo.topic == topic {
            return Ok(true);
        }
    }
    Ok(false)
}

fn todo_paths(config: &ProjectConfig) -> Result<Vec<std::path::PathBuf>> {
    let directory = config.todo_path();
    fs::create_dir_all(&directory)?;
    Ok(fs::read_dir(directory)?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| path.is_file() && supported(path))
        .collect())
}

fn relative(config: &ProjectConfig, path: &Path) -> String {
    path.strip_prefix(&config.root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

struct Todo {
    to: String,
    topic: String,
    body: String,
}

fn parse(content: &str, leader: &str, path: &str) -> Todo {
    let normalized = content.replace("\r\n", "\n");
    let mut to = leader.to_string();
    let mut topic = path.to_string();
    let mut body_start = 0;
    for line in normalized.lines() {
        let consumed = line.len() + 1;
        if let Some(value) = line.strip_prefix("to:") {
            to = value.trim().to_string();
            body_start += consumed;
        } else if let Some(value) = line.strip_prefix("topic:") {
            topic = value.trim().to_string();
            body_start += consumed;
        } else if line.trim().is_empty() && body_start > 0 {
            body_start += consumed;
            break;
        } else {
            break;
        }
    }
    Todo {
        to,
        topic,
        body: normalized[body_start.min(normalized.len())..]
            .trim()
            .to_string(),
    }
}

fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| matches!(extension, "md" | "txt" | "todo"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_targeted_todo() {
        let todo = parse(
            "to: sauce\ntopic: sauce-work\n\nBuild sauce.",
            "head",
            "x.todo",
        );
        assert_eq!(todo.to, "sauce");
        assert_eq!(todo.topic, "sauce-work");
        assert_eq!(todo.body, "Build sauce.");
    }
}
