use std::{future::Future, path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use tokio::sync::{mpsc, oneshot, watch};

use crate::{
    config::CopilotConfig,
    models::WorkerSpec,
    persistent_runner::{
        AgentEntry, AgentHandle, Job, PersistentCopilotRunner, ReadyAgent, StartupState,
    },
    persistent_runner_state::{
        clear_stopped_session, entry_is_current, entry_session_id, evict_entry,
        publish_ready_if_current, reusable_for_session, wait_for_startup,
    },
};

impl PersistentCopilotRunner {
    pub(crate) async fn ensure_with<F, Fut>(
        &self,
        root: PathBuf,
        worker: WorkerSpec,
        session_id: String,
        start: F,
    ) -> Result<ReadyAgent>
    where
        F: FnOnce(
                CopilotConfig,
                PathBuf,
                WorkerSpec,
                String,
                mpsc::Receiver<Job>,
                oneshot::Sender<Result<String>>,
            ) -> Fut
            + Send
            + 'static,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        let worker_id = worker.id.clone();
        let hook_revision = crate::acp_profile::hook_revision()?;
        let (entry, startup, stale) = {
            let mut agents = self.agents.lock().await;
            if let Some(entry) = agents.get(&worker_id)
                && reusable_with_hook(entry, &session_id, &worker.model, &hook_revision)
            {
                (entry.clone(), None, None)
            } else {
                let stale = agents.remove(&worker_id);
                let (state_tx, state_rx) = watch::channel(StartupState::Pending);
                let (stop_tx, stop_rx) = watch::channel(false);
                let entry = Arc::new(AgentEntry {
                    state: state_rx,
                    requested_session_id: session_id.clone(),
                    requested_model: worker.model.clone(),
                    hook_revision,
                    delivered_sections: std::sync::Mutex::new(std::collections::HashMap::new()),
                    delivered_body: std::sync::Mutex::new(std::collections::HashMap::new()),
                    stop: stop_tx,
                });
                agents.insert(worker_id.clone(), entry.clone());
                (entry, Some((state_tx, stop_rx)), stale)
            }
        };
        if let Some(stale) = &stale {
            stale.stop.send_replace(true);
        }
        drop(stale);
        let Some((state_tx, mut stop_rx)) = startup else {
            return wait_for_startup(entry).await;
        };

        let (jobs, receiver) = mpsc::channel(8);
        let (ready_tx, ready_rx) = oneshot::channel();
        let config = self.config.clone();
        let agent_worker = worker.clone();
        let process_worker_id = worker_id.clone();
        let process_root = root.clone();
        let startup_root = process_root.clone();
        let process_agents = self.agents.clone();
        let process_entry = entry.clone();
        tokio::spawn(async move {
            let result = tokio::select! {
                result = start(config, root, agent_worker, session_id, receiver, ready_tx) => result,
                _ = stop_rx.changed() => Ok(()),
            };
            if let Err(error) = result {
                tracing::error!(
                    agent = %process_worker_id,
                    %error,
                    "persistent Copilot agent stopped"
                );
            }
            if entry_is_current(&process_agents, &process_worker_id, &process_entry).await {
                let session_id = entry_session_id(&process_entry);
                if let Err(error) =
                    clear_stopped_session(&process_root, &process_worker_id, &session_id).await
                {
                    tracing::error!(
                        agent = %process_worker_id,
                        %error,
                        "could not clear stopped Copilot session"
                    );
                }
                evict_entry(&process_agents, &process_worker_id, &process_entry).await;
            }
        });
        let agents = self.agents.clone();
        let startup_entry = entry.clone();
        tokio::spawn(async move {
            let result = ready_rx
                .await
                .context("Copilot ACP startup channel closed")
                .and_then(|result| result)
                .map(|session_id| AgentHandle { jobs, session_id });
            match result {
                Ok(handle) => {
                    publish_ready_if_current(
                        &agents,
                        &worker_id,
                        &startup_entry,
                        &state_tx,
                        handle,
                    )
                    .await;
                }
                Err(error) => {
                    let session_id = entry_session_id(&startup_entry);
                    let failure =
                        match clear_stopped_session(&startup_root, &worker_id, &session_id).await {
                            Ok(()) => format!("{error:#}"),
                            Err(clear_error) => format!(
                                "could not clear failed Copilot startup session for {worker_id}: \
                             {clear_error:#}"
                            ),
                        };
                    evict_entry(&agents, &worker_id, &startup_entry).await;
                    state_tx.send_replace(StartupState::Failed(failure));
                }
            }
        });
        wait_for_startup(entry).await
    }
}

pub(crate) fn reusable_with_hook(
    entry: &AgentEntry,
    session_id: &str,
    model: &str,
    hook_revision: &str,
) -> bool {
    reusable_for_session(entry, session_id, model) && entry.hook_revision == hook_revision
}
