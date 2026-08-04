use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use anyhow::{Result, bail};
use tokio::{task::JoinSet, time::sleep};

use crate::orchestrator::Harness;

pub(crate) async fn wait_for_idle(
    harness: &Harness,
    active: &AtomicUsize,
    idle_for: Duration,
    tasks: &mut JoinSet<Result<()>>,
) -> Result<()> {
    let mut idle = Duration::ZERO;
    let tick = Duration::from_millis(25);
    loop {
        tokio::select! {
            result = tasks.join_next() => {
                match result {
                    Some(result) => {
                        result??;
                        bail!("worker stopped before harness shutdown");
                    }
                    None => bail!("all workers stopped before harness shutdown"),
                }
            }
            _ = sleep(tick) => {
                if harness.ingest_work().await? > 0 {
                    idle = Duration::ZERO;
                    continue;
                }
                if harness.store.open_task_count().await? == 0
                    && active.load(Ordering::SeqCst) == 0
                {
                    idle += tick;
                    if idle >= idle_for {
                        return Ok(());
                    }
                } else {
                    idle = Duration::ZERO;
                }
            }
        }
    }
}
