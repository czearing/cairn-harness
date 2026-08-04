use std::path::{Path, PathBuf};

use anyhow::{Result, ensure};
use chrono::{Duration, Utc};

use crate::{
    config::ProjectConfig, models::Assignment, release_store::ReleaseFinalization, store::Store,
};

pub async fn publish(config: &ProjectConfig, store: &Store, task: &Assignment) -> Result<bool> {
    if config.idea_agents().is_empty() {
        return Ok(false);
    }
    let Some(finalization) = store.release_finalization(&task.id).await? else {
        return Ok(false);
    };
    reconcile_one(config, store, finalization).await
}

pub(crate) async fn reconcile(config: &ProjectConfig, store: &Store) -> Result<usize> {
    if config.idea_agents().is_empty() {
        return Ok(0);
    }
    let pending = store.due_release_finalizations(16).await?;
    let mut published = 0;
    for finalization in pending {
        if reconcile_one(config, store, finalization).await? {
            published += 1;
        }
    }
    Ok(published)
}

async fn reconcile_one(
    config: &ProjectConfig,
    store: &Store,
    finalization: ReleaseFinalization,
) -> Result<bool> {
    match write(config, store, &finalization).await {
        Ok(()) => {
            store
                .acknowledge_release_finalization(&finalization.task_id, &finalization.content_hash)
                .await?;
            Ok(true)
        }
        Err(error) => {
            let delay_ms = (100_u64.saturating_mul(1 << finalization.attempts.min(8))).min(30_000);
            let next_attempt_at =
                (Utc::now() + Duration::milliseconds(delay_ms as i64)).to_rfc3339();
            let detail = format!("{error:#}");
            store
                .record_release_finalization_failure(
                    &finalization.task_id,
                    &detail,
                    &next_attempt_at,
                )
                .await?;
            tracing::error!(
                task_id = %finalization.task_id,
                attempts = finalization.attempts + 1,
                retry_at = %next_attempt_at,
                error = %detail,
                "release finalization pending; fix filesystem/database access or restart the harness"
            );
            Ok(false)
        }
    }
}

async fn write(
    config: &ProjectConfig,
    store: &Store,
    finalization: &ReleaseFinalization,
) -> Result<()> {
    let computed_hash = blake3::hash(finalization.content.as_bytes())
        .to_hex()
        .to_string();
    ensure!(
        computed_hash == finalization.content_hash,
        "committed release content no longer matches its finalization hash"
    );
    let relative = PathBuf::from("releases").join(format!("{}.md", finalization.content_hash));
    let path = config.root.join(&relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    fail_file_once()?;
    if !matches_hash(&path, &finalization.content_hash)? {
        atomic_write(&path, &finalization.content)?;
    }

    fail_database_once()?;
    store
        .add_release(
            &finalization.content_hash,
            &finalization.agent,
            &finalization.topic,
            &finalization.content,
            &relative.to_string_lossy().replace('\\', "/"),
        )
        .await?;
    ensure!(
        matches_hash(&path, &finalization.content_hash)?,
        "release file does not match committed content"
    );
    ensure!(
        store
            .release_matches(
                &finalization.content_hash,
                &finalization.content,
                &relative.to_string_lossy().replace('\\', "/"),
            )
            .await?,
        "release database row does not match committed content"
    );
    Ok(())
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

#[cfg(test)]
static FAIL_FILE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(test)]
static FAIL_DATABASE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
fn fail_file_once() -> Result<()> {
    if FAIL_FILE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return Err(anyhow::anyhow!("injected release file failure"));
    }
    Ok(())
}

#[cfg(not(test))]
fn fail_file_once() -> Result<()> {
    Ok(())
}

#[cfg(test)]
fn fail_database_once() -> Result<()> {
    if FAIL_DATABASE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return Err(anyhow::anyhow!("injected release database failure"));
    }
    Ok(())
}

#[cfg(not(test))]
fn fail_database_once() -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        future::Future,
        pin::Pin,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration as StdDuration,
    };

    use tempfile::tempdir;

    use super::*;
    use crate::{
        config::{CopilotConfig, ProjectConfig, RoleConfig},
        models::{AgentOutput, RunRequest},
        orchestrator::Harness,
        runner::AgentRunner,
    };

    struct CompletingRunner {
        store: Store,
        calls: Arc<AtomicUsize>,
    }

    impl AgentRunner for CompletingRunner {
        fn run<'a>(
            &'a self,
            request: RunRequest,
        ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                self.store
                    .complete_current(&request.worker.id, "durable release")
                    .await?;
                Ok(AgentOutput {
                    summary: "completed".into(),
                    deliverable: Some("durable release".into()),
                    tools: Vec::new(),
                    complete: true,
                })
            })
        }
    }

    #[tokio::test]
    async fn committed_release_recovers_file_and_database_failures_without_rerunning_agent() {
        for failure in ["file", "database"] {
            let directory = tempdir().unwrap();
            let config = test_config(directory.path().to_path_buf());
            let store = Store::open(&config.database_path()).await.unwrap();
            let calls = Arc::new(AtomicUsize::new(0));
            let runner = Arc::new(CompletingRunner {
                store: store.clone(),
                calls: calls.clone(),
            });
            let harness = Harness::new(config.clone(), store.clone(), runner.clone());
            harness.bootstrap().await.unwrap();
            let task_id = store
                .create_root("producer", "worker", failure, "publish", "automatic", None)
                .await
                .unwrap();
            match failure {
                "file" => FAIL_FILE.store(true, Ordering::SeqCst),
                "database" => FAIL_DATABASE.store(true, Ordering::SeqCst),
                _ => unreachable!(),
            }

            harness
                .run_until_idle(StdDuration::from_millis(50))
                .await
                .unwrap();

            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert_eq!(store.task_status(&task_id).await.unwrap(), "completed");
            assert_eq!(store.pending_release_finalization_count().await.unwrap(), 1);
            assert_eq!(store.release_count().await.unwrap(), 0);
            let release_directory = config.root.join("releases");
            let files_before_restart = std::fs::read_dir(&release_directory).unwrap().count();
            assert_eq!(files_before_restart, usize::from(failure == "database"));

            let reopened = Store::open(&config.database_path()).await.unwrap();
            let restarted = Harness::new(config.clone(), reopened.clone(), runner.clone());
            restarted.bootstrap().await.unwrap();

            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert_eq!(reopened.release_count().await.unwrap(), 1);
            assert_eq!(
                std::fs::read_dir(config.root.join("releases"))
                    .unwrap()
                    .count(),
                1
            );
            assert_eq!(
                reopened.pending_release_finalization_count().await.unwrap(),
                0
            );
            let (published,): (i64,) =
                sqlx::query_as("SELECT COUNT(*) FROM published_task_releases WHERE task_id=?")
                    .bind(&task_id)
                    .fetch_one(&reopened.pool)
                    .await
                    .unwrap();
            assert_eq!(published, 1);

            assert_eq!(reconcile(&config, &reopened).await.unwrap(), 0);
            assert_eq!(reopened.release_count().await.unwrap(), 1);
            assert_eq!(
                std::fs::read_dir(config.root.join("releases"))
                    .unwrap()
                    .count(),
                1
            );
        }
    }

    fn test_config(root: PathBuf) -> ProjectConfig {
        ProjectConfig {
            name: "Release recovery".into(),
            root,
            paused: false,
            configuration_revision: 0,
            agent_deletion_operations: Vec::new(),
            leader: Some("worker".into()),
            leader_task_limit: Some(3),
            max_active_tasks: None,
            idea_agents: Vec::new(),
            producer: Some("producer".into()),
            producer_limit: Some(1),
            producer_prompt: Some("Create work.".into()),
            producer_retry_cooldown_seconds: 86_400,
            work_dir: None,
            roles: vec![
                RoleConfig {
                    name: "worker".into(),
                    agent_kind: None,
                    source_agent: None,
                    instance_ordinal: None,
                    title: None,
                    template: None,
                    capabilities: Vec::new(),
                    replica_eligible: false,
                    description: "Worker".into(),
                    prompt: "Work.".into(),
                    model: None,
                    appearance: None,
                },
                RoleConfig {
                    name: "producer".into(),
                    agent_kind: None,
                    source_agent: None,
                    instance_ordinal: None,
                    title: None,
                    template: None,
                    capabilities: Vec::new(),
                    replica_eligible: false,
                    description: "Producer".into(),
                    prompt: "Produce.".into(),
                    model: None,
                    appearance: None,
                },
            ],
            copilot: CopilotConfig::default(),
        }
    }
}
