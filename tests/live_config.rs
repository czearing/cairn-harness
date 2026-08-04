use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
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
use tokio::sync::{Mutex as AsyncMutex, mpsc, oneshot};

struct RecordingRunner {
    store: Store,
    requests: Mutex<Vec<RecordedRequest>>,
    calls: AtomicUsize,
    first_started: mpsc::UnboundedSender<()>,
    release_first: AsyncMutex<Option<oneshot::Receiver<()>>>,
}

struct RecordedRequest {
    prompt: String,
    worker_description: String,
    worker_prompt: String,
    session_id: String,
}

impl AgentRunner for RecordingRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(RecordedRequest {
                prompt: request.prompt.clone(),
                worker_description: request.worker.description.clone(),
                worker_prompt: request.worker.prompt.clone(),
                session_id: request.session_id.clone(),
            });
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                let _ = self.first_started.send(());
                if let Some(release) = self.release_first.lock().await.take() {
                    let _ = release.await;
                }
            }
            self.store
                .complete_current(&request.worker.id, "completed")
                .await?;
            Ok(AgentOutput {
                summary: "completed".into(),
                deliverable: None,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn live_workers_reload_agent_and_peer_instructions_between_queued_turns() {
    let directory = tempdir().unwrap();
    let root = directory.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    let config_path = directory.path().join("project.json");
    write_config(
        &config_path,
        &root,
        "Old lead description",
        "Old lead prompt.",
        "Old peer description",
    );
    let config = ProjectConfig::load(&config_path).unwrap();
    let store = Store::open(&config.database_path()).await.unwrap();
    let (first_started, mut started) = mpsc::unbounded_channel();
    let (release_first, first_release) = oneshot::channel();
    let runner = Arc::new(RecordingRunner {
        store: store.clone(),
        requests: Mutex::new(Vec::new()),
        calls: AtomicUsize::new(0),
        first_started,
        release_first: AsyncMutex::new(Some(first_release)),
    });
    let harness = Arc::new(
        Harness::new(config, store.clone(), runner.clone()).with_config_path(config_path.clone()),
    );
    harness.bootstrap().await.unwrap();
    store.set_session("lead", "existing-session").await.unwrap();
    harness
        .send("human", "lead", "first", "First task")
        .await
        .unwrap();
    harness
        .send("human", "lead", "second", "Second task")
        .await
        .unwrap();

    let running_harness = harness.clone();
    let running = tokio::spawn(async move {
        running_harness
            .run_steps(2, Duration::from_millis(100))
            .await
    });
    tokio::time::timeout(Duration::from_secs(1), started.recv())
        .await
        .expect("first turn did not start")
        .expect("first turn signal closed");

    write_config(
        &config_path,
        &root,
        "New lead description",
        "New lead prompt.",
        "New peer description",
    );
    release_first.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), running)
        .await
        .expect("live worker did not finish queued turns")
        .unwrap()
        .unwrap();

    let requests = runner.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(
        requests[0]
            .prompt
            .contains("Old lead description. Old lead prompt.")
    );
    assert!(requests[0].prompt.contains("peer=Old peer description"));
    assert!(
        requests[1]
            .prompt
            .contains("New lead description. New lead prompt.")
    );
    assert!(requests[1].prompt.contains("peer=New peer description"));
    assert_eq!(requests[1].worker_description, "New lead description");
    assert_eq!(requests[1].worker_prompt, "New lead prompt.");
    assert!(
        requests
            .iter()
            .all(|request| request.session_id == "existing-session")
    );
}

fn write_config(
    path: &std::path::Path,
    root: &std::path::Path,
    lead_description: &str,
    lead_prompt: &str,
    peer_description: &str,
) {
    std::fs::write(
        path,
        format!(
            r#"{{"name":"Live","root":{},"leader":"lead","roles":[{{"name":"lead","description":{},"prompt":{}}},{{"name":"peer","description":{},"prompt":"Peer."}}]}}"#,
            serde_json::to_string(root).unwrap(),
            serde_json::to_string(lead_description).unwrap(),
            serde_json::to_string(lead_prompt).unwrap(),
            serde_json::to_string(peer_description).unwrap(),
        ),
    )
    .unwrap();
}
