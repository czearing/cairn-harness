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
    models::{AgentOutput, RunRequest},
    orchestrator::Harness,
    policy::RuntimePolicy,
    runner::AgentRunner,
    store::Store,
};
use chrono::{Duration as ChronoDuration, Utc};
use tempfile::tempdir;

use common::config;

struct ScriptedRunner {
    store: Store,
    complete_after: Option<usize>,
    calls: AtomicUsize,
}

struct CommitThenErrorRunner {
    store: Store,
}

struct OutputOnlyRunner;

impl AgentRunner for OutputOnlyRunner {
    fn run<'a>(
        &'a self,
        _request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async {
            Ok(AgentOutput {
                summary: "completed without protocol".into(),
                deliverable: Some("full result".into()),
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

impl AgentRunner for CommitThenErrorRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.store
                .complete_current(&request.worker.id, "committed result")
                .await?;
            bail!("ACP failed after task_complete")
        })
    }
}

#[tokio::test]
async fn dashboard_assignments_are_root_work_not_peer_messages() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let worker = &config.workers()[0];
    store.register(worker).await.unwrap();

    store
        .create_message("human", &worker.id, "goal", "work")
        .await
        .unwrap();
    let assignment = store.claim(&worker.id).await.unwrap().unwrap();

    assert_eq!(assignment.kind, "root");
    assert_eq!(assignment.source, "manual");
}

#[tokio::test]
async fn one_generator_cannot_create_multiple_roots() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }
    store.create_generator("pm", "create work").await.unwrap();
    store.claim("pm").await.unwrap().unwrap();
    store
        .create_from_generator("pm", "pm", "first", "first body")
        .await
        .unwrap();

    let error = store
        .create_from_generator("pm", "pm", "second", "second body")
        .await
        .unwrap_err();

    assert!(error.to_string().contains("already created"));
    assert_eq!(store.automatic_seed_count().await.unwrap(), 1);
}

impl AgentRunner for ScriptedRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if self.complete_after.is_some_and(|limit| call < limit) {
                bail!("transient failure");
            }
            if self.complete_after.is_some() {
                self.store
                    .complete_current(&request.worker.id, "done")
                    .await?;
            }
            Ok(AgentOutput {
                summary: "done".into(),
                deliverable: None,
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn transient_failures_retry_then_commit_once() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(ScriptedRunner {
        store: store.clone(),
        complete_after: Some(3),
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
    assert_eq!(harness.store().completed_task_count().await.unwrap(), 1);
}

#[tokio::test]
async fn committed_completion_survives_a_later_acp_error() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(CommitThenErrorRunner {
        store: store.clone(),
    });
    let harness = Harness::new(config, store, runner);
    harness.bootstrap().await.unwrap();
    harness.send("human", "pm", "goal", "work").await.unwrap();

    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();

    assert_eq!(harness.store().completed_task_count().await.unwrap(), 1);
    assert_eq!(harness.store().task_count("failed").await.unwrap(), 0);
}

#[tokio::test]
async fn one_hundred_complete_outputs_finish_without_task_complete_calls() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let mut policy = RuntimePolicy::for_workers(config.workers().len());
    policy.max_runs_per_start = 100;
    let store = Store::open(&config.database_path()).await.unwrap();
    let harness = Harness::with_policy(config, store, Arc::new(OutputOnlyRunner), policy);
    harness.bootstrap().await.unwrap();
    for index in 0..100 {
        harness
            .send("human", "pm", &format!("task-{index}"), "complete normally")
            .await
            .unwrap();
    }

    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();

    assert_eq!(harness.store().completed_task_count().await.unwrap(), 100);
    assert_eq!(harness.store().task_count("failed").await.unwrap(), 0);
}

#[tokio::test]
async fn complete_output_does_not_retry_for_a_missing_tool_transition() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let mut policy = RuntimePolicy::for_workers(config.workers().len());
    policy.max_runs_per_start = 3;
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(ScriptedRunner {
        store: store.clone(),
        complete_after: None,
        calls: AtomicUsize::new(0),
    });
    let harness = Harness::with_policy(config, store, runner.clone(), policy);
    harness.bootstrap().await.unwrap();
    harness.send("human", "pm", "goal", "work").await.unwrap();
    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();
    assert_eq!(runner.calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.store().completed_task_count().await.unwrap(), 1);
    assert_eq!(harness.store().task_count("failed").await.unwrap(), 0);
}

#[tokio::test]
async fn stale_claims_return_to_the_same_task_row() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let worker = &config.workers()[0];
    store.register(worker).await.unwrap();
    store
        .create_message("human", &worker.id, "goal", "work")
        .await
        .unwrap();
    let first = store.claim(&worker.id).await.unwrap().unwrap();
    let future = (Utc::now() + ChronoDuration::seconds(1)).to_rfc3339();
    assert_eq!(store.recover(&future).await.unwrap(), 1);
    let second = store.claim(&worker.id).await.unwrap().unwrap();
    assert_eq!(first.id, second.id);
}

#[tokio::test]
async fn repeated_delegation_is_idempotent() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }

    store
        .create_message("human", "pm", "goal", "work")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();
    let first = store
        .delegate_current("pm", "designer", "design", "body")
        .await
        .unwrap();
    let second = store
        .delegate_current("pm", "designer", "design", "body")
        .await
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(store.task_count("pending").await.unwrap(), 1);
}

#[tokio::test]
async fn completed_delegation_cannot_be_misreported_as_new_work() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }
    store
        .create_message("human", "pm", "goal", "work")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();
    store
        .delegate_current("pm", "designer", "design", "body")
        .await
        .unwrap();
    store.claim("designer").await.unwrap().unwrap();
    store.complete_current("designer", "done").await.unwrap();
    store.claim("pm").await.unwrap().unwrap();

    let error = store
        .delegate_current("pm", "designer", "design", "body")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("already reached terminal state"));
}

#[tokio::test]
async fn failed_grandchild_requeues_each_waiting_ancestor_with_error_context() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }

    let root = store
        .create_message("human", "pm", "goal", "work")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();
    let child = store
        .delegate_current("pm", "designer", "design", "body")
        .await
        .unwrap();
    store.claim("designer").await.unwrap().unwrap();
    let grandchild = store
        .delegate_current("designer", "coder", "build", "body")
        .await
        .unwrap();
    store.claim("coder").await.unwrap().unwrap();

    store
        .finish(
            &grandchild,
            "failed",
            Some("required MCP tools unavailable"),
        )
        .await
        .unwrap();

    assert_eq!(store.task_status(&child).await.unwrap(), "pending");
    let results = store.terminal_children(&child).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].status, "failed");
    assert_eq!(results[0].result, "required MCP tools unavailable");

    store.claim("designer").await.unwrap().unwrap();
    store
        .complete_current("designer", "recovered")
        .await
        .unwrap();
    assert_eq!(store.task_status(&root).await.unwrap(), "pending");
}
