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
    models::{AgentOutput, OutgoingMessage, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;

#[derive(Default)]
struct StoryRunner {
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
            if request.prompt.contains("Topic: context-probe") {
                return Ok(output(
                    "Recalled the prior concept.",
                    Some("The Last Lantern"),
                    Vec::new(),
                ));
            }
            match request.worker.role.as_str() {
                "concept" => Ok(output(
                    "Created one concept.",
                    Some("The Last Lantern: a keeper must extinguish the final memory of home."),
                    vec![message(
                        "writer",
                        "story-concept",
                        "Title: The Last Lantern. A keeper must choose whether to extinguish the final memory of home.",
                    )],
                )),
                "writer" => Ok(output(
                    "Wrote the final story.",
                    Some("The last lantern burned after every star had gone dark."),
                    Vec::new(),
                )),
                role => panic!("unexpected role {role}"),
            }
        })
    }
}

#[tokio::test]
async fn story_flow_is_ordered_minimal_and_restart_safe() {
    let temp = tempdir().unwrap();
    let config = story_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(StoryRunner::default());
    let harness = Harness::new(config.clone(), store, runner.clone());

    harness
        .run_until_idle(Duration::from_millis(125))
        .await
        .unwrap();
    let first = harness.store().transcript().await.unwrap();
    assert_eq!(roles(&first), ["concept", "writer"]);
    assert_eq!(first[0].output.messages.len(), 1);
    assert!(first[1].output.messages.is_empty());
    assert!(
        first[1]
            .output
            .deliverable
            .as_deref()
            .unwrap()
            .contains("lantern")
    );
    assert_eq!(harness.store().ingested_todo_count().await.unwrap(), 1);

    drop(harness);
    tokio::time::sleep(Duration::from_millis(50)).await;
    let store = Store::open(&config.database_path()).await.unwrap();
    let restarted = Harness::new(config, store, runner.clone());
    restarted
        .run_until_idle(Duration::from_millis(75))
        .await
        .unwrap();
    assert_eq!(restarted.store().transcript().await.unwrap().len(), 2);
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
    assert_eq!(transcript.len(), 3);
    assert!(
        transcript[2]
            .output
            .deliverable
            .as_deref()
            .unwrap()
            .contains("Last Lantern")
    );
    {
        let sessions = runner.sessions.lock().unwrap();
        let concept_sessions = &sessions["concept"];
        assert_eq!(concept_sessions[0], concept_sessions[1]);
    }
    assert!(
        restarted
            .transcript(false)
            .await
            .unwrap()
            .contains("Session:")
    );
}

fn story_config(root: &std::path::Path) -> ProjectConfig {
    let example =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/short-story/project.json");
    let text = std::fs::read_to_string(example)
        .unwrap()
        .replace("\"root\": \".\"", "\"root\": \"workspace\"");
    let path = root.join("project.json");
    std::fs::write(&path, text).unwrap();
    let workspace = root.join("workspace");
    std::fs::create_dir_all(workspace.join("todos")).unwrap();
    std::fs::write(
        workspace.join("todos/story.todo"),
        "Write me a short story.",
    )
    .unwrap();
    ProjectConfig::load(&path).unwrap()
}

fn roles(entries: &[cairn_harness::models::TranscriptEntry]) -> Vec<&str> {
    entries
        .iter()
        .map(|entry| entry.agent_id.as_str())
        .collect()
}

fn output(summary: &str, deliverable: Option<&str>, messages: Vec<OutgoingMessage>) -> AgentOutput {
    AgentOutput {
        summary: summary.into(),
        deliverable: deliverable.map(str::to_owned),
        messages,
        tools: Vec::new(),
        complete: true,
    }
}

fn message(to: &str, topic: &str, body: &str) -> OutgoingMessage {
    OutgoingMessage {
        to: to.into(),
        topic: topic.into(),
        body: body.into(),
    }
}
