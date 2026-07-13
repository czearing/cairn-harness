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
    models::{AgentOutput, OutgoingMessage, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;

struct PoemRunner {
    ideas: AtomicUsize,
}

impl AgentRunner for PoemRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let output = match request.worker.role.as_str() {
                "author" => {
                    let number = self.ideas.fetch_add(1, Ordering::SeqCst) + 1;
                    message_output(
                        "writer",
                        "poem-idea",
                        &format!("Idea {number}: rain in a cup"),
                    )
                }
                "writer" => AgentOutput {
                    summary: "Wrote poem.".into(),
                    deliverable: Some("Rain waits in a cup.\nMorning holds the rim.".into()),
                    messages: vec![OutgoingMessage {
                        to: "editor".into(),
                        topic: "poem-draft".into(),
                        body: "Review this poem.".into(),
                    }],
                    complete: true,
                },
                "editor" => AgentOutput {
                    summary: "Edited poem.".into(),
                    deliverable: Some("Rain waits in a cup.\nMorning holds the rim.".into()),
                    messages: Vec::new(),
                    complete: true,
                },
                role => panic!("unexpected role {role}"),
            };
            Ok(output)
        })
    }
}

#[tokio::test]
async fn idle_queue_seeds_and_releases_a_poem_cycle() {
    let temp = tempdir().unwrap();
    let config = poem_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config.clone(), store, runner.clone());

    harness.bootstrap().await.unwrap();
    assert!(harness.replenish().await.unwrap());
    for _ in 0..3 {
        harness
            .run_steps(1, Duration::from_millis(75))
            .await
            .unwrap();
    }

    assert_eq!(harness.store().release_count().await.unwrap(), 1);
    assert_eq!(harness.store().open_message_count().await.unwrap(), 0);
    let transcript = harness.store().transcript().await.unwrap();
    assert!(transcript[2].inbound_body.contains("Rain waits in a cup"));
    let releases = config.root.join("releases");
    assert_eq!(std::fs::read_dir(releases).unwrap().count(), 1);

    drop(harness);
    let store = Store::open(&config.database_path()).await.unwrap();
    let restarted = Harness::new(config, store, runner);
    restarted.bootstrap().await.unwrap();
    assert!(restarted.replenish().await.unwrap());
    let seed = restarted.store().claim("author").await.unwrap().unwrap();
    assert!(seed.body.contains("Rain waits in a cup"));
}

#[tokio::test]
async fn bounded_watch_runs_one_complete_cycle() {
    let temp = tempdir().unwrap();
    let config = poem_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store, runner);
    tokio::time::timeout(Duration::from_secs(3), harness.watch_until(1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(harness.store().release_count().await.unwrap(), 1);
    assert_eq!(harness.store().open_message_count().await.unwrap(), 0);
}

#[tokio::test]
async fn bounded_watch_fails_on_duplicate_release_stall() {
    let temp = tempdir().unwrap();
    let config = poem_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PoemRunner {
        ideas: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store, runner);
    let result = tokio::time::timeout(Duration::from_secs(5), harness.watch_until(2))
        .await
        .unwrap();
    assert!(result.is_err());
    assert_eq!(harness.store().release_count().await.unwrap(), 1);
}

fn poem_config(root: &std::path::Path) -> ProjectConfig {
    let example =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/poem-loop/project.json");
    let text = std::fs::read_to_string(example)
        .unwrap()
        .replace("\"root\": \".\"", "\"root\": \"workspace\"");
    let path = root.join("project.json");
    std::fs::write(&path, text).unwrap();
    std::fs::create_dir_all(root.join("workspace")).unwrap();
    ProjectConfig::load(&path).unwrap()
}

fn message_output(to: &str, topic: &str, body: &str) -> AgentOutput {
    AgentOutput {
        summary: "Handed off.".into(),
        deliverable: None,
        messages: vec![OutgoingMessage {
            to: to.into(),
            topic: topic.into(),
            body: body.into(),
        }],
        complete: true,
    }
}
