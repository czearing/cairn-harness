mod common;

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Result;
use cairn_harness::{
    models::{AgentOutput, OutgoingMessage, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;

use common::config;

#[derive(Default)]
struct FakeRunner {
    prompts: Mutex<Vec<String>>,
}

impl AgentRunner for FakeRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.prompts.lock().unwrap().push(request.prompt);
            let messages = match request.worker.role.as_str() {
                "pm" => vec![message("designer", "design", "Define the interaction.")],
                "designer" => vec![message("coder", "build", "Implement the contract.")],
                _ => Vec::new(),
            };
            Ok(AgentOutput {
                summary: format!("{} completed work", request.worker.id),
                deliverable: None,
                messages,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn agents_exchange_messages_without_turn_scheduler() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(FakeRunner::default());
    let harness = Harness::new(config, store, runner.clone());

    harness.bootstrap().await.unwrap();
    harness
        .send("human", "pm", "goal", "Create the product.")
        .await
        .unwrap();
    harness
        .run_until_idle(Duration::from_millis(150))
        .await
        .unwrap();

    assert_eq!(harness.store().completed_message_count().await.unwrap(), 3);
    assert_eq!(harness.store().open_message_count().await.unwrap(), 0);
    let prompts = runner.prompts.lock().unwrap();
    assert_eq!(prompts.len(), 3);
    assert!(prompts.iter().all(|prompt| prompt.contains("Activity:")));
}

fn message(to: &str, topic: &str, body: &str) -> OutgoingMessage {
    OutgoingMessage {
        to: to.into(),
        topic: topic.into(),
        body: body.into(),
    }
}
