use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

use anyhow::Result;
use tokio::{
    sync::{Semaphore, watch},
    task::JoinSet,
    time::sleep,
};

use crate::{
    orchestrator::Harness,
    worker::{self, WorkerContext},
};

pub async fn run(harness: &Harness, release_target: Option<i64>) -> Result<()> {
    harness.bootstrap().await?;
    let active = Arc::new(AtomicUsize::new(0));
    let budget = Arc::new(AtomicUsize::new(usize::MAX));
    let gate = Arc::new(Semaphore::new(harness.policy.max_concurrency));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let mut tasks = JoinSet::new();
    let mut seeds = 0_i64;
    for worker in harness.config.workers() {
        tasks.spawn(worker::run(WorkerContext {
            config: harness.config.clone(),
            worker,
            store: harness.store.clone(),
            runner: harness.runner.clone(),
            directory: harness.directory.clone(),
            gate: gate.clone(),
            active: active.clone(),
            budget: budget.clone(),
            policy: harness.policy.clone(),
            shutdown: shutdown_rx.clone(),
        }));
    }
    loop {
        tokio::select! {
            signal = tokio::signal::ctrl_c() => {
                signal?;
                break;
            }
            _ = sleep(Duration::from_millis(250)) => {
                harness.ingest_todos().await?;
                harness.ingest_work().await?;
                if let Some(target) = release_target
                    && harness.store.release_count().await? >= target
                {
                    break;
                }
                if active.load(Ordering::SeqCst) == 0
                    && harness.replenish().await?
                {
                    seeds += 1;
                }
                if let Some(target) = release_target
                    && seeds > target.saturating_mul(2).max(4)
                {
                    anyhow::bail!("bounded watch stalled on duplicate releases");
                }
            }
            result = tasks.join_next() => {
                match result {
                    Some(result) => result??,
                    None => break,
                }
            }
        }
    }
    shutdown_tx.send(true)?;
    while let Some(result) = tasks.join_next().await {
        result??;
    }
    Ok(())
}
