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

use anyhow::Result;
use cairn_harness::{
    models::{AgentOutput, RunRequest},
    orchestrator::Harness,
    policy::RuntimePolicy,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;

use common::config;

struct DelayRunner {
    active: AtomicUsize,
    maximum: AtomicUsize,
}

impl AgentRunner for DelayRunner {
    fn run<'a>(
        &'a self,
        _request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.maximum.fetch_max(active, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(75)).await;
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(AgentOutput {
                summary: "done".into(),
                deliverable: None,
                messages: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn configured_semaphore_caps_parallel_agents() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let mut policy = RuntimePolicy::for_workers(config.workers().len());
    policy.max_concurrency = 1;
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(DelayRunner {
        active: AtomicUsize::new(0),
        maximum: AtomicUsize::new(0),
    });
    let harness = Harness::with_policy(config, store, runner.clone(), policy);
    harness.bootstrap().await.unwrap();
    harness.send("human", "pm", "one", "work").await.unwrap();
    harness
        .send("human", "designer", "two", "work")
        .await
        .unwrap();

    harness
        .run_until_idle(Duration::from_millis(150))
        .await
        .unwrap();

    assert_eq!(runner.maximum.load(Ordering::SeqCst), 1);
}
