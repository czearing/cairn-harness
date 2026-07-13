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
    policy::RuntimePolicy,
    runner::AgentRunner,
    store::Store,
    todo, transcript,
    worker::{WorkerContext, run},
};

pub struct Harness {
    pub(crate) config: ProjectConfig,
    pub(crate) store: Store,
    pub(crate) runner: Arc<dyn AgentRunner>,
    pub(crate) directory: Arc<Directory>,
    pub(crate) policy: RuntimePolicy,
}

impl Harness {
    pub fn new(config: ProjectConfig, store: Store, runner: Arc<dyn AgentRunner>) -> Self {
        let policy = RuntimePolicy::for_workers(config.workers().len());
        Self::with_policy(config, store, runner, policy)
    }

    pub fn with_policy(
        config: ProjectConfig,
        store: Store,
        runner: Arc<dyn AgentRunner>,
        policy: RuntimePolicy,
    ) -> Self {
        let directory = Arc::new(build(&config.workers()));
        Self {
            config,
            store,
            runner,
            directory,
            policy,
        }
    }

    pub fn config(&self) -> &ProjectConfig {
        &self.config
    }

    pub async fn bootstrap(&self) -> Result<()> {
        let lease = ChronoDuration::milliseconds(self.policy.claim_lease_ms as i64);
        self.store
            .recover(&(Utc::now() - lease).to_rfc3339())
            .await?;
        for worker in self.config.workers() {
            let state = self.store.register(&worker).await?;
            if let Some(session_id) = self
                .runner
                .warm(self.config.root.clone(), worker, state.session_id)
                .await?
            {
                self.store.set_session(&state.agent_id, &session_id).await?;
            }
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

    pub async fn ingest_todos(&self) -> Result<usize> {
        let leader = resolve(&self.directory, self.config.leader())?
            .into_iter()
            .next()
            .expect("validated leader has one worker");
        todo::ingest(&self.config, &self.store, &leader).await
    }

    pub async fn transcript(&self, full: bool) -> Result<String> {
        Ok(transcript::markdown(&self.store.transcript().await?, full))
    }

    pub async fn watch(&self) -> Result<()> {
        crate::watch::run(self, None).await
    }

    pub async fn watch_until(&self, releases: i64) -> Result<()> {
        crate::watch::run(self, Some(releases)).await
    }

    pub async fn run_until_idle(&self, idle_for: Duration) -> Result<()> {
        self.run_with_budget(idle_for, self.policy.max_runs_per_start)
            .await
    }

    pub async fn run_steps(&self, steps: usize, idle_for: Duration) -> Result<()> {
        if steps == 0 {
            bail!("steps must be greater than zero");
        }
        self.run_with_budget(idle_for, steps).await
    }

    async fn run_with_budget(&self, idle_for: Duration, runs: usize) -> Result<()> {
        self.bootstrap().await?;
        self.ingest_todos().await?;
        let active = Arc::new(AtomicUsize::new(0));
        let budget = Arc::new(AtomicUsize::new(runs));
        let gate = Arc::new(Semaphore::new(self.policy.max_concurrency));
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
                policy: self.policy.clone(),
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
