use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use anyhow::Result;
use cairn_harness::{
    config::ProjectConfig,
    models::{AgentOutput, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;
use tokio::sync::Barrier;

struct SongRunner {
    store: Store,
    active: AtomicUsize,
    maximum: AtomicUsize,
    specialists: Barrier,
}

impl AgentRunner for SongRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let final_pass = request.prompt.contains("Child results:");
            let deliverable = if request.worker.role == "idea-manager" && !final_pass {
                for (to, topic) in [
                    ("lyricist", "lyrics"),
                    ("composer", "composition"),
                    ("cover-artist", "cover"),
                ] {
                    self.store
                        .delegate_current("idea-manager", to, topic, &format!("Complete {topic}."))
                        .await?;
                }
                None
            } else if request.worker.role == "idea-manager" {
                let package = "Approved song package.";
                self.store.complete_current("idea-manager", package).await?;
                Some(package.into())
            } else {
                let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                self.maximum.fetch_max(active, Ordering::SeqCst);
                self.specialists.wait().await;
                tokio::time::sleep(Duration::from_millis(75)).await;
                let result = format!("{} deliverable", request.worker.role);
                self.store
                    .complete_current(&request.worker.id, &result)
                    .await?;
                self.active.fetch_sub(1, Ordering::SeqCst);
                Some(result)
            };
            Ok(AgentOutput {
                summary: "Song work advanced.".into(),
                deliverable,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn root_task_delegates_parallel_specialists_and_releases() {
    let temp = tempdir().unwrap();
    let config = song_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(SongRunner {
        store: store.clone(),
        active: AtomicUsize::new(0),
        maximum: AtomicUsize::new(0),
        specialists: Barrier::new(3),
    });
    let harness = Harness::new(config, store, runner.clone());
    harness.bootstrap().await.unwrap();
    harness
        .store()
        .create_root(
            "human",
            "idea-manager",
            "song",
            "Create one song package.",
            "manual",
            None,
        )
        .await
        .unwrap();
    harness
        .run_until_idle(Duration::from_millis(125))
        .await
        .unwrap();
    assert_eq!(runner.maximum.load(Ordering::SeqCst), 3);
    assert_eq!(harness.store().completed_task_count().await.unwrap(), 4);
    assert_eq!(harness.store().release_count().await.unwrap(), 1);
    assert_eq!(harness.store().open_task_count().await.unwrap(), 0);
}

fn song_config(root: &std::path::Path) -> ProjectConfig {
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let path = root.join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Song","root":{},"leader":"idea-manager","producer":"idea-manager","roles":[
        {{"name":"idea-manager","description":"Lead","prompt":"Lead."}},
        {{"name":"lyricist","description":"Lyrics","prompt":"Write."}},
        {{"name":"composer","description":"Composition","prompt":"Compose."}},
        {{"name":"cover-artist","description":"Cover","prompt":"Design."}}]}}"#,
            serde_json::to_string(&workspace).unwrap()
        ),
    )
    .unwrap();
    ProjectConfig::load(&path).unwrap()
}
