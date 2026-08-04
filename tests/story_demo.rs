use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
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

struct StoryRunner {
    store: Store,
    sessions: Mutex<HashMap<String, Vec<String>>>,
}

impl AgentRunner for StoryRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.sessions
                .lock()
                .unwrap()
                .entry(request.worker.id.clone())
                .or_default()
                .push(request.session_id);
            let result = if request.prompt.contains("[context-probe]") {
                self.store
                    .complete_current("concept", "The Last Lantern")
                    .await?;
                "The Last Lantern"
            } else if request.worker.role == "concept" && !request.prompt.contains("Child results:")
            {
                self.store
                    .delegate_current(
                        "concept",
                        "writer",
                        "story-concept",
                        "Write The Last Lantern.",
                    )
                    .await?;
                "Delegated the story."
            } else if request.worker.role == "writer" {
                self.store
                    .complete_current(
                        "writer",
                        "The last lantern burned after every star had gone dark.",
                    )
                    .await?;
                "Wrote the story."
            } else {
                self.store
                    .complete_current("concept", "The Last Lantern is complete.")
                    .await?;
                "Completed the concept."
            };
            Ok(AgentOutput {
                summary: result.into(),
                deliverable: Some(result.into()),
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn story_flow_is_ordered_and_restart_safe() {
    let temp = tempdir().unwrap();
    let config = story_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(StoryRunner {
        store: store.clone(),
        sessions: Mutex::new(HashMap::new()),
    });
    let harness = Harness::new(config.clone(), store, runner.clone());
    harness.bootstrap().await.unwrap();
    harness
        .send("human", "concept", "story", "Write a short story.")
        .await
        .unwrap();
    harness
        .run_until_idle(Duration::from_millis(125))
        .await
        .unwrap();
    assert_eq!(harness.store().completed_task_count().await.unwrap(), 2);

    drop(harness);
    let store = Store::open(&config.database_path()).await.unwrap();
    let restarted = Harness::new(config, store, runner.clone());
    restarted
        .send(
            "human",
            "concept",
            "context-probe",
            "Recall the prior title.",
        )
        .await
        .unwrap();
    restarted
        .run_until_idle(Duration::from_millis(75))
        .await
        .unwrap();
    let transcript = restarted.store().transcript().await.unwrap();
    assert_eq!(transcript.len(), 4);
    assert!(
        transcript
            .last()
            .unwrap()
            .output
            .deliverable
            .as_deref()
            .unwrap()
            .contains("Last Lantern")
    );
    let sessions = runner.sessions.lock().unwrap();
    let concept = &sessions["concept"];
    assert_eq!(concept[0], concept[2]);
}

fn story_config(root: &std::path::Path) -> ProjectConfig {
    let path = root.join("project.json");
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::write(&path, format!(
        r#"{{"name":"Story","root":{},"leader":"concept","roles":[{{"name":"concept","description":"Concept lead","prompt":"Lead."}},{{"name":"writer","description":"Writer","prompt":"Write."}}]}}"#,
        serde_json::to_string(&workspace).unwrap()
    )).unwrap();
    ProjectConfig::load(&path).unwrap()
}
