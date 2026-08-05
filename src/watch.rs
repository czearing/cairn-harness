use std::sync::{Arc, atomic::AtomicUsize};
use std::time::Duration;

use anyhow::Result;
use tokio::{
    sync::{Semaphore, watch},
    task::JoinSet,
    time::{MissedTickBehavior, interval, sleep},
};

use crate::{
    orchestrator::Harness,
    worker::{self, WorkerContext},
};

/// How long a standby watcher waits before retrying the ownership slot.
const STANDBY_RETRY: Duration = Duration::from_secs(5);

pub async fn run(harness: &Harness, release_target: Option<i64>) -> Result<()> {
    let owner = crate::worker_instance::instance_owner();
    if !acquire_or_standby(harness, &owner, release_target).await? {
        return Ok(());
    }
    let result = run_owned(harness, release_target, &owner).await;
    harness.store.release_worker_instance(&owner).await?;
    result
}

/// Waits for the exclusive watcher slot instead of exiting immediately.
///
/// A losing watcher that exits is restarted by the supervisor within a second,
/// which turns a duplicate launch into an unbounded respawn storm that contends
/// on the same SQLite file and starves the real worker. Standing by keeps the
/// process alive so the supervisor sees it running, and promotes it if the
/// owner dies. Bounded runs still exit so they cannot hang.
async fn acquire_or_standby(
    harness: &Harness,
    owner: &str,
    release_target: Option<i64>,
) -> Result<bool> {
    let mut announced = false;
    loop {
        if harness
            .store
            .acquire_worker_instance(owner, harness.policy.claim_lease_ms)
            .await?
        {
            return Ok(true);
        }
        if release_target.is_some() {
            tracing::warn!(owner = %owner, "another watcher owns this harness database; exiting");
            return Ok(false);
        }
        if !announced {
            announced = true;
            tracing::warn!(owner = %owner, "another watcher owns this harness database; standing by");
        }
        sleep(STANDBY_RETRY).await;
    }
}

async fn run_owned(harness: &Harness, release_target: Option<i64>, owner: &str) -> Result<()> {
    harness.bootstrap().await?;
    crate::telemetry::version::record_start(&harness.store).await?;
    let active = Arc::new(AtomicUsize::new(0));
    let budget = Arc::new(AtomicUsize::new(usize::MAX));
    let gate = Arc::new(Semaphore::new(harness.policy.max_concurrency));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let mut tasks = JoinSet::new();
    let mut seeds = 0_i64;
    let mut recovery = interval(Duration::from_millis(
        (harness.policy.claim_lease_ms / 3).max(100),
    ));
    recovery.set_missed_tick_behavior(MissedTickBehavior::Skip);
    for worker in harness.config.workers() {
        tasks.spawn(worker::run(WorkerContext {
            config: harness.config.clone(),
            config_path: harness.config_path.clone(),
            worker,
            store: harness.store.clone(),
            runner: harness.runner.clone(),
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
                harness.ingest_work().await?;
                crate::release::reconcile(&harness.config, &harness.store).await?;
                if let Some(target) = release_target
                    && harness.store.release_count().await? >= target
                {
                    break;
                }
                if harness.replenish().await? {
                    seeds += 1;
                }
                if let Some(target) = release_target
                    && seeds > target.saturating_mul(2).max(4)
                {
                    anyhow::bail!("bounded watch stalled on duplicate releases");
                }
            }
            _ = recovery.tick() => {
                if !harness.store.renew_worker_instance(owner).await? {
                    tracing::warn!(
                        owner = %owner,
                        "another watcher took ownership of this harness database; stopping"
                    );
                    break;
                }
                let recovered = harness.recover_stale_claims().await?;
                if recovered > 0 {
                    tracing::warn!(recovered, "requeued stale claimed tasks");
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
