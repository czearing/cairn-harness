use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use anyhow::{Result, bail};
use chrono::{Duration as ChronoDuration, Utc};
use tokio::{
    sync::{Semaphore, watch},
    task::JoinSet,
    time::sleep,
};

use crate::{
    config::ProjectConfig,
    directory::{Directory, build, resolve},
    models::AgentState,
    runner::AgentRunner,
    store::Store,
    worker::{WorkerContext, run},
};

pub struct Harness {
    config: ProjectConfig,
    store: Store,
    runner: Arc<dyn AgentRunner>,
    directory: Arc<Directory>,
}

impl Harness {
    pub fn new(config: ProjectConfig, store: Store, runner: Arc<dyn AgentRunner>) -> Self {
        let directory = Arc::new(build(&config.workers()));
        Self {
            config,
            store,
            runner,
            directory,
        }
    }

    pub fn config(&self) -> &ProjectConfig {
        &self.config
    }

    pub async fn bootstrap(&self) -> Result<()> {
        let lease = ChronoDuration::milliseconds(self.config.team.claim_lease_ms as i64);
        self.store
            .recover(&(Utc::now() - lease).to_rfc3339())
            .await?;
        for worker in self.config.workers() {
            self.store.register(&worker).await?;
        }
        Ok(())
    }

    pub async fn send(&self, from: &str, to: &str, topic: &str, body: &str) -> Result<usize> {
        let recipients = resolve(&self.directory, to)?;
        for recipient in &recipients {
            self.store.enqueue(from, recipient, topic, body).await?;
        }
        Ok(recipients.len())
    }

    pub async fn status(&self) -> Result<Vec<AgentState>> {
        self.store.states().await
    }

    pub async fn run_until_idle(&self, idle_for: Duration) -> Result<()> {
        self.bootstrap().await?;
        let active = Arc::new(AtomicUsize::new(0));
        let budget = Arc::new(AtomicUsize::new(self.config.team.max_runs_per_start));
        let gate = Arc::new(Semaphore::new(self.config.team.max_concurrency));
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let mut tasks = JoinSet::new();
        for worker in self.config.workers() {
            tasks.spawn(run(WorkerContext {
                config: self.config.clone(),
                worker,
                store: self.store.clone(),
                runner: self.runner.clone(),
                directory: self.directory.clone(),
                gate: gate.clone(),
                active: active.clone(),
                budget: budget.clone(),
                shutdown: shutdown_rx.clone(),
            }));
        }
        wait_for_idle(&self.store, &active, idle_for, &mut tasks).await?;
        shutdown_tx.send(true)?;
        while let Some(result) = tasks.join_next().await {
            result??;
        }
        Ok(())
    }

    pub fn store(&self) -> &Store {
        &self.store
    }
}

async fn wait_for_idle(
    store: &Store,
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
                if store.open_message_count().await? == 0
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
