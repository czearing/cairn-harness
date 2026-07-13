mod common;

use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use anyhow::{Result, bail};
use cairn_harness::{
    models::{AgentOutput, OutgoingMessage, RunRequest},
    orchestrator::Harness,
    policy::RuntimePolicy,
    runner::AgentRunner,
    store::Store,
};
use chrono::{Duration as ChronoDuration, Utc};
use tempfile::tempdir;

use common::config;

struct ScriptedRunner {
    mode: Mode,
    calls: AtomicUsize,
}

enum Mode {
    UnknownTarget,
    RetryTwice,
    SelfLoop,
}

impl AgentRunner for ScriptedRunner {
    fn run<'a>(
        &'a self,
        _request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if matches!(self.mode, Mode::RetryTwice) && call < 3 {
                bail!("transient failure");
            }
            let messages = match self.mode {
                Mode::UnknownTarget => vec![message("ghost")],
                Mode::SelfLoop => vec![message("pm")],
                Mode::RetryTwice => Vec::new(),
            };
            Ok(AgentOutput {
                summary: "done".into(),
                deliverable: None,
                messages,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn invalid_recipient_is_dead_lettered_without_stopping_team() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(ScriptedRunner {
        mode: Mode::UnknownTarget,
        calls: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store, runner);
    harness.bootstrap().await.unwrap();
    harness.send("human", "pm", "goal", "work").await.unwrap();
    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();
    assert_eq!(harness.store().dead_letter_count().await.unwrap(), 1);
    assert_eq!(harness.store().completed_message_count().await.unwrap(), 1);
}

#[tokio::test]
async fn transient_failures_retry_to_configured_limit() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(ScriptedRunner {
        mode: Mode::RetryTwice,
        calls: AtomicUsize::new(0),
    });
    let harness = Harness::new(config, store, runner.clone());
    harness.bootstrap().await.unwrap();
    harness.send("human", "pm", "goal", "work").await.unwrap();
    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();
    assert_eq!(runner.calls.load(Ordering::SeqCst), 3);
    assert_eq!(harness.store().completed_message_count().await.unwrap(), 1);
}

#[tokio::test]
async fn run_budget_stops_unbounded_agent_ping_pong() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let mut policy = RuntimePolicy::for_workers(config.workers().len());
    policy.max_runs_per_start = 3;
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(ScriptedRunner {
        mode: Mode::SelfLoop,
        calls: AtomicUsize::new(0),
    });
    let harness = Harness::with_policy(config, store, runner.clone(), policy);
    harness.bootstrap().await.unwrap();
    harness.send("human", "pm", "loop", "work").await.unwrap();
    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();
    assert_eq!(runner.calls.load(Ordering::SeqCst), 3);
    assert_eq!(harness.store().message_count("deferred").await.unwrap(), 1);
}

#[tokio::test]
async fn stale_claims_return_to_the_inbox() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let worker = &config.workers()[0];
    store.register(worker).await.unwrap();
    store
        .enqueue("human", &worker.id, "goal", "work")
        .await
        .unwrap();
    assert!(store.claim(&worker.id).await.unwrap().is_some());
    let future = (Utc::now() + ChronoDuration::seconds(1)).to_rfc3339();
    assert_eq!(store.recover(&future).await.unwrap(), 1);
    assert!(store.claim(&worker.id).await.unwrap().is_some());
}

#[tokio::test]
async fn deterministic_handoff_ids_prevent_duplicates() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    store
        .enqueue_keyed("source:0:writer", "concept", "writer", "idea", "body")
        .await
        .unwrap();
    store
        .enqueue_keyed("source:0:writer", "concept", "writer", "idea", "body")
        .await
        .unwrap();
    assert_eq!(store.message_count("pending").await.unwrap(), 1);
}

fn message(to: &str) -> OutgoingMessage {
    OutgoingMessage {
        to: to.into(),
        topic: "next".into(),
        body: "continue".into(),
    }
}
