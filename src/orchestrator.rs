use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicUsize},
    time::Duration,
};

use anyhow::{Result, bail};
use chrono::{Duration as ChronoDuration, Utc};
use tokio::{
    sync::{Semaphore, watch},
    task::JoinSet,
};

use crate::{
    config::ProjectConfig,
    directory::{Directory, build, resolve},
    models::AgentState,
    policy::RuntimePolicy,
    runner::AgentRunner,
    store::Store,
    transcript,
    worker::{WorkerContext, run},
};

pub struct Harness {
    pub(crate) config: ProjectConfig,
    pub(crate) config_path: Option<PathBuf>,
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
            config_path: None,
            store,
            runner,
            directory,
            policy,
        }
    }

    pub fn config(&self) -> &ProjectConfig {
        &self.config
    }

    pub fn with_config_path(mut self, config_path: PathBuf) -> Self {
        self.config_path = Some(config_path);
        self
    }

    pub async fn bootstrap(&self) -> Result<()> {
        self.store
            .set_publication_enabled(!self.config.idea_agents().is_empty());
        self.recover_stale_claims().await?;
        self.store
            .set_max_active_tasks(self.config.max_active_tasks, self.config.leader())
            .await?;
        for worker in self.config.workers() {
            self.store.register(&worker).await?;
        }
        self.store
            .configure_replica_profiles(&self.config.roles)
            .await?;
        if !self.config.idea_agents().is_empty() {
            self.store.backfill_release_finalizations().await?;
            self.store.schedule_release_finalizations_now().await?;
            crate::release::reconcile(&self.config, &self.store).await?;
            let pending = self.store.pending_release_finalization_count().await?;
            if pending > 0 {
                tracing::warn!(
                    pending,
                    "release finalization remains pending; keep watch running or restart after fixing filesystem/database access"
                );
            }
        }
        Ok(())
    }

    pub(crate) async fn recover_stale_claims(&self) -> Result<u64> {
        // Fail delegations aimed at agents no longer in the live roster before recover()'s
        // waiting-parent promotion runs, so a parent blocked only by a since-deleted delegate
        // resolves in this same pass instead of waiting forever on a target nobody polls for.
        let active_agent_ids: Vec<String> =
            self.config.workers().into_iter().map(|worker| worker.id).collect();
        self.store
            .fail_orphaned_delegations(&active_agent_ids)
            .await?;
        let lease = ChronoDuration::milliseconds(self.policy.claim_lease_ms as i64);
        self.store.recover(&(Utc::now() - lease).to_rfc3339()).await
    }

    pub async fn send(&self, from: &str, to: &str, topic: &str, body: &str) -> Result<usize> {
        let recipients = resolve(&self.directory, to)?;
        for recipient in &recipients {
            self.store
                .create_message(from, recipient, topic, body)
                .await?;
        }
        Ok(recipients.len())
    }

    pub async fn status(&self) -> Result<Vec<AgentState>> {
        self.store.states().await
    }

    pub async fn ingest_work(&self) -> Result<usize> {
        crate::work_item::ingest(&self.config, &self.store).await
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
        crate::telemetry::version::record_start(&self.store).await?;
        self.ingest_work().await?;
        let active = Arc::new(AtomicUsize::new(0));
        let budget = Arc::new(AtomicUsize::new(runs));
        let gate = Arc::new(Semaphore::new(self.policy.max_concurrency));
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let mut tasks = JoinSet::new();
        for worker in self.config.workers() {
            tasks.spawn(run(WorkerContext {
                config: self.config.clone(),
                config_path: self.config_path.clone(),
                worker,
                store: self.store.clone(),
                runner: self.runner.clone(),
                gate: gate.clone(),
                active: active.clone(),
                budget: budget.clone(),
                policy: self.policy.clone(),
                shutdown: shutdown_rx.clone(),
            }));
        }
        crate::orchestrator_idle::wait_for_idle(self, &active, idle_for, &mut tasks).await?;
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
