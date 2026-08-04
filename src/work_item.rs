use std::{collections::HashSet, path::Path};

use anyhow::Result;

use crate::{config::ProjectConfig, store::Store};

pub async fn ingest(config: &ProjectConfig, store: &Store) -> Result<usize> {
    let Some(root) = config.work_path() else {
        return Ok(0);
    };
    let inbox = root.join("inbox");
    std::fs::create_dir_all(&inbox)?;
    let agents = config
        .workers()
        .into_iter()
        .map(|worker| worker.id)
        .collect::<HashSet<_>>();
    let mut count = ingest_directory(&inbox, config.leader(), store).await?;
    for entry in std::fs::read_dir(inbox)? {
        let source = entry?.path();
        if !source.is_dir() {
            continue;
        }
        let Some(agent) = source.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !agents.contains(agent) {
            tracing::error!(folder = %source.display(), "unknown agent work folder");
            continue;
        }
        count += ingest_directory(&source, agent, store).await?;
    }
    Ok(count)
}

async fn ingest_directory(directory: &Path, assignee: &str, store: &Store) -> Result<usize> {
    let mut count = 0;
    for entry in std::fs::read_dir(directory)? {
        let source = entry?.path();
        if !source.is_file() || source.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let body = std::fs::read_to_string(&source)?;
        if body.trim().is_empty() {
            continue;
        }
        let hash = blake3::hash(body.as_bytes()).to_hex();
        let origin = format!("import:{hash}");
        store
            .create_root(
                "work-items",
                assignee,
                "work-item",
                body.trim(),
                "import",
                Some(&origin),
            )
            .await?;
        std::fs::remove_file(source)?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn imports_file_once_into_canonical_tasks() {
        let directory = tempdir().unwrap();
        let inbox = directory.path().join("work-items/inbox");
        std::fs::create_dir_all(&inbox).unwrap();
        std::fs::write(inbox.join("task.md"), "Build launch.\n").unwrap();
        let config_path = directory.path().join("project.json");
        std::fs::write(
            &config_path,
            r#"{"name":"Test","root":".","leader":"lead","work_dir":"work-items","roles":[{"name":"lead","description":"Lead","prompt":"Lead"}]}"#,
        )
        .unwrap();
        let config = ProjectConfig::load(&config_path).unwrap();
        let store = Store::open(&config.database_path()).await.unwrap();

        assert_eq!(ingest(&config, &store).await.unwrap(), 1);
        assert_eq!(ingest(&config, &store).await.unwrap(), 0);
        let (body,): (String,) = sqlx::query_as("SELECT body FROM tasks WHERE kind='root'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(body, "Build launch.");
        assert!(!inbox.join("task.md").exists());
    }

    #[tokio::test]
    async fn agent_folder_assigns_directly_without_leader_delegation() {
        let (directory, config, store) = fixture().await;
        let inbox = directory.path().join("work-items/inbox");
        let reviewer = inbox.join("reviewer");
        std::fs::create_dir_all(&reviewer).unwrap();
        std::fs::write(reviewer.join("pr.md"), "Review PR 42.\n").unwrap();
        std::fs::write(reviewer.join("partial.tmp"), "Ignore this.\n").unwrap();

        assert_eq!(ingest(&config, &store).await.unwrap(), 1);
        let (assignee, body): (String, String) =
            sqlx::query_as("SELECT assignee,body FROM tasks WHERE kind='root'")
                .fetch_one(&store.pool)
                .await
                .unwrap();

        assert_eq!(assignee, "reviewer");
        assert_eq!(body, "Review PR 42.");
        assert!(reviewer.join("partial.tmp").exists());
    }

    #[tokio::test]
    async fn unknown_agent_folder_remains_untouched() {
        let (directory, config, store) = fixture().await;
        let unknown = directory.path().join("work-items/inbox/missing");
        std::fs::create_dir_all(&unknown).unwrap();
        std::fs::write(unknown.join("task.md"), "Do not consume.\n").unwrap();

        assert_eq!(ingest(&config, &store).await.unwrap(), 0);
        assert!(unknown.join("task.md").exists());
    }

    async fn fixture() -> (tempfile::TempDir, ProjectConfig, Store) {
        let directory = tempdir().unwrap();
        let config_path = directory.path().join("project.json");
        std::fs::write(
            &config_path,
            r#"{"name":"Test","root":".","leader":"lead","work_dir":"work-items","roles":[{"name":"lead","description":"Lead","prompt":"Lead"},{"name":"reviewer","description":"Review","prompt":"Review"}]}"#,
        )
        .unwrap();
        let config = ProjectConfig::load(&config_path).unwrap();
        let store = Store::open(&config.database_path()).await.unwrap();
        (directory, config, store)
    }
}
