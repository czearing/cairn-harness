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

struct PoemRunner {
    store: Store,
    ideas: AtomicUsize,
}

impl AgentRunner for PoemRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let prompt = &request.prompt;
            let deliverable = if prompt.contains("Call task_create once") {
                let number = self.ideas.fetch_add(1, Ordering::SeqCst) + 1;
                self.store
                    .create_from_generator(
                        "author",
                        "author",
                        "poem",
                        &format!("Write poem {number} about rain in a cup."),
                    )
                    .await?;
                None
            } else if request.worker.role == "author" && !prompt.contains("Child results:") {
                self.store
                    .delegate_current("author", "writer", "draft", "Write the poem.")
                    .await?;
                None
            } else if request.worker.role == "writer" {
                self.store
                    .complete_current("writer", "Rain waits in a cup.\nMorning holds the rim.")
                    .await?;
                Some("Rain waits in a cup.\nMorning holds the rim.".into())
            } else {
                let poem = "Rain waits in a cup.\nMorning holds the rim.";
                self.store.complete_current("author", poem).await?;
                Some(poem.into())
            };
            Ok(AgentOutput {
                summary: "Poem cycle advanced.".into(),
                deliverable,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn automatic_task_becomes_visible_work_and_releases() {
    let temp = tempdir().unwrap();
    let config = poem_config(temp.path(), Some(1));
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        store: store.clone(),
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config.clone(), store, runner);
    harness.bootstrap().await.unwrap();
    assert!(harness.replenish().await.unwrap());
    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();
    assert_eq!(harness.store().automatic_seed_count().await.unwrap(), 0);
    assert_eq!(harness.store().release_count().await.unwrap(), 1);
    assert_eq!(harness.store().open_task_count().await.unwrap(), 0);
    assert!(harness.replenish().await.unwrap());
    let generator = harness.store().claim("author").await.unwrap().unwrap();
    assert!(generator.body.contains("Existing topics: poem"));
    assert!(!generator.body.contains("Rain waits in a cup."));
    assert_eq!(
        std::fs::read_dir(config.root.join("releases"))
            .unwrap()
            .count(),
        1
    );
}

#[tokio::test]
async fn automatic_limit_counts_only_active_roots() {
    let temp = tempdir().unwrap();
    let config = poem_config(temp.path(), Some(2));
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        store: store.clone(),
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store, runner);
    harness.bootstrap().await.unwrap();

    assert!(harness.replenish().await.unwrap());
    assert!(!harness.replenish().await.unwrap());
    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();

    assert_eq!(harness.store().automatic_seed_count().await.unwrap(), 0);
    assert!(harness.replenish().await.unwrap());
}

#[tokio::test]
async fn automatic_minimum_replenishes_while_other_work_is_active() {
    let temp = tempdir().unwrap();
    let config = poem_config(temp.path(), Some(2));
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        store: store.clone(),
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store, runner);
    harness.bootstrap().await.unwrap();
    harness
        .store()
        .create_root(
            "author",
            "author",
            "first",
            "Active work.",
            "automatic",
            None,
        )
        .await
        .unwrap();

    assert!(harness.replenish().await.unwrap());
}

#[tokio::test]
async fn producer_limit_replenishes_only_after_a_root_completes() {
    let temp = tempdir().unwrap();
    let config = buffered_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        store: store.clone(),
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store.clone(), runner);
    harness.bootstrap().await.unwrap();
    for topic in ["first", "second"] {
        store
            .create_root("scout", "author", topic, "Active work.", "automatic", None)
            .await
            .unwrap();
    }

    assert!(!harness.replenish().await.unwrap());
    store.claim("author").await.unwrap().unwrap();
    store.complete_current("author", "Done.").await.unwrap();
    assert!(harness.replenish().await.unwrap());
    assert_eq!(store.pending_generator_count_for("scout").await.unwrap(), 1);
}

#[tokio::test]
async fn bounded_watch_runs_one_complete_cycle() {
    let temp = tempdir().unwrap();
    let config = poem_config(temp.path(), Some(1));
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        store: store.clone(),
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store, runner);
    tokio::time::timeout(Duration::from_secs(4), harness.watch_until(1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(harness.store().release_count().await.unwrap(), 1);
}

fn poem_config(root: &std::path::Path, limit: Option<u64>) -> ProjectConfig {
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let path = root.join("project.json");
    std::fs::write(&path, format!(
        r#"{{"name":"Poems","root":{},"leader":"author","producer":"author","producer_limit":{},"producer_prompt":"Create poems","roles":[{{"name":"author","description":"Author","prompt":"Lead."}},{{"name":"writer","description":"Writer","prompt":"Write."}}]}}"#,
        serde_json::to_string(&workspace).unwrap(),
        limit.unwrap_or(1)
    )).unwrap();
    ProjectConfig::load(&path).unwrap()
}

fn buffered_config(root: &std::path::Path) -> ProjectConfig {
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let path = root.join("buffered-project.json");
    std::fs::write(&path, format!(
        r#"{{"name":"Buffered","root":{},"leader":"author","producer":"scout","producer_limit":2,"producer_prompt":"Create work","roles":[{{"name":"author","description":"Author","prompt":"Lead."}},{{"name":"scout","description":"Scout","prompt":"Find."}}]}}"#,
        serde_json::to_string(&workspace).unwrap()
    )).unwrap();
    ProjectConfig::load(&path).unwrap()
}
