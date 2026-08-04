mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Result;
use cairn_harness::{
    models::{AgentOutput, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;
use tokio::{sync::Notify, time::timeout};

use common::config;

struct ToolRunner {
    store: Store,
    prompts: Mutex<Vec<String>>,
}

impl AgentRunner for ToolRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.prompts.lock().unwrap().push(request.prompt.clone());
            let has_results = request.prompt.contains("Child results:");
            match (request.worker.role.as_str(), has_results) {
                ("pm", false) => {
                    self.store
                        .delegate_current("pm", "designer", "design", "Define the interaction.")
                        .await?;
                }
                ("designer", false) => {
                    self.store
                        .delegate_current("designer", "coder", "build", "Implement the contract.")
                        .await?;
                }
                _ => {
                    self.store
                        .complete_current(
                            &request.worker.id,
                            &format!("{} result", request.worker.id),
                        )
                        .await?;
                }
            }
            Ok(output(&request.worker.id))
        })
    }
}

#[tokio::test]
async fn one_task_graph_drives_the_full_delegation_chain() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let database = config.database_path();
    let store = Store::open(&database).await.unwrap();
    let runner = Arc::new(ToolRunner {
        store: store.clone(),
        prompts: Mutex::new(Vec::new()),
    });
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

    assert_eq!(harness.store().completed_task_count().await.unwrap(), 3);
    assert_eq!(harness.store().open_task_count().await.unwrap(), 0);
    let prompts = runner.prompts.lock().unwrap();
    assert_eq!(prompts.len(), 5, "{prompts:#?}");
    assert_eq!(
        prompts
            .iter()
            .filter(|prompt| prompt.contains("Child results:"))
            .count(),
        2
    );
    assert!(prompts.iter().any(|prompt| {
        prompt.contains(
            "Never delegate, poll, duplicate, relay, or leave a long-lived server running",
        )
    }));
    assert!(
        prompts
            .iter()
            .any(|prompt| prompt.contains("Wait for dependencies")
                && prompt.contains("host will return completed child results"))
    );
}

fn output(agent: &str) -> AgentOutput {
    AgentOutput {
        summary: format!("{agent} handled its canonical task"),
        deliverable: None,
        tools: vec!["cairn-harness/task_complete".into()],
        complete: true,
    }
}

struct MessageRunner {
    calls: Mutex<Vec<String>>,
}

struct OrderedMessageRunner {
    store: Store,
    calls: AtomicUsize,
    started: Notify,
    release: Notify,
}

impl AgentRunner for OrderedMessageRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                self.started.notify_one();
                self.release.notified().await;
            }
            self.store
                .complete_current(&request.worker.id, "Message answered.")
                .await?;
            Ok(AgentOutput {
                summary: format!("Answered {}", request.prompt),
                deliverable: None,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

impl AgentRunner for MessageRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(request.prompt);
            Ok(AgentOutput {
                summary: "Message incorporated.".into(),
                deliverable: None,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn bootstrap_does_not_start_idle_agents() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(MessageRunner {
        calls: Mutex::new(Vec::new()),
    });
    let harness = Harness::new(config, store, runner.clone());

    harness.bootstrap().await.unwrap();

    assert!(runner.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn peer_notes_close_without_a_task_complete_tool_call() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(MessageRunner {
        calls: Mutex::new(Vec::new()),
    });
    let harness = Harness::new(config, store, runner.clone());
    harness.bootstrap().await.unwrap();
    harness
        .store()
        .create_message("human", "pm", "goal", "Coordinate the layout.")
        .await
        .unwrap();
    harness.store().claim("pm").await.unwrap().unwrap();
    harness
        .store()
        .send_peer_message("pm", "designer", "note", "Use the compact layout.")
        .await
        .unwrap();
    harness
        .store()
        .complete_current("pm", "Sent the note.")
        .await
        .unwrap();

    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();

    assert_eq!(harness.store().completed_task_count().await.unwrap(), 2);
    let prompts = runner.calls.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert!(prompts[0].contains("host closes this note"));
}

#[tokio::test]
async fn busy_agent_followups_persist_and_are_answered_in_order() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let database = config.database_path();
    let store = Store::open(&database).await.unwrap();
    let runner = Arc::new(OrderedMessageRunner {
        store: store.clone(),
        calls: AtomicUsize::new(0),
        started: Notify::new(),
        release: Notify::new(),
    });
    let harness = Arc::new(Harness::new(config, store, runner.clone()));
    harness.bootstrap().await.unwrap();
    harness
        .send("human", "pm", "dashboard-message", "First message.")
        .await
        .unwrap();

    let running = {
        let harness = harness.clone();
        tokio::spawn(async move { harness.run_until_idle(Duration::from_millis(100)).await })
    };
    timeout(Duration::from_secs(2), runner.started.notified())
        .await
        .unwrap();
    harness
        .send("human", "pm", "dashboard-message", "Second message.")
        .await
        .unwrap();
    harness
        .send("human", "pm", "dashboard-message", "Third message.")
        .await
        .unwrap();
    assert_eq!(harness.store().open_task_count().await.unwrap(), 3);
    runner.release.notify_one();
    timeout(Duration::from_secs(5), running)
        .await
        .unwrap()
        .unwrap()
        .unwrap();

    let transcript = harness.store().transcript().await.unwrap();
    assert_eq!(
        transcript
            .iter()
            .map(|turn| turn.inbound_body.as_str())
            .collect::<Vec<_>>(),
        ["First message.", "Second message.", "Third message."]
    );
    assert!(transcript.iter().all(|turn| turn.status == "completed"));
    let context = harness.store().agent_context("pm").await.unwrap();
    assert!(context.contains("First message."));
    assert!(context.contains("Second message."));
    assert!(context.contains("Third message."));

    drop(harness);
    let reopened = Store::open(&database).await.unwrap();
    assert_eq!(reopened.open_task_count().await.unwrap(), 0);
    assert_eq!(reopened.transcript().await.unwrap().len(), 3);
}
