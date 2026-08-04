use std::{collections::HashMap, future::Future, path::PathBuf, pin::Pin, sync::Arc};

use anyhow::{Result, anyhow};
use tokio::sync::{Mutex, mpsc, oneshot, watch};

#[cfg(test)]
use crate::persistent_runner_state::{
    clear_stopped_session, publish_ready_if_current, reusable_for_session,
};
use crate::{
    acp_process,
    config::CopilotConfig,
    models::{AgentOutput, RunRequest, WorkerSpec},
    persistent_runner_state::{
        cleanly_cancelled, evict_entry, persist_session, requires_fresh_session, retry_same_task,
        send_job, set_session,
    },
    runner::{AgentRunner, wait_for_cancellation},
};

pub struct PersistentCopilotRunner {
    pub(crate) config: CopilotConfig,
    pub(crate) agents: Arc<Mutex<HashMap<String, Arc<AgentEntry>>>>,
}

#[derive(Clone)]
pub(crate) struct AgentHandle {
    pub(crate) jobs: mpsc::Sender<Job>,
    pub(crate) session_id: String,
}

pub(crate) struct ReadyAgent {
    pub(crate) handle: AgentHandle,
    pub(crate) entry: Arc<AgentEntry>,
}

pub(crate) struct AgentEntry {
    pub(crate) state: watch::Receiver<StartupState>,
    pub(crate) requested_session_id: String,
    pub(crate) requested_model: String,
    pub(crate) hook_revision: String,
    pub(crate) stop: watch::Sender<bool>,
}

#[derive(Clone)]
pub(crate) enum StartupState {
    Pending,
    Ready(AgentHandle),
    Failed(String),
}

pub(crate) struct Job {
    pub prompt: String,
    pub response: oneshot::Sender<Result<AgentOutput>>,
    pub cancellation: watch::Receiver<bool>,
}

type StartFuture = Pin<Box<dyn Future<Output = Result<()>> + Send>>;
type StartAgent = Arc<
    dyn Fn(
            CopilotConfig,
            PathBuf,
            WorkerSpec,
            String,
            mpsc::Receiver<Job>,
            oneshot::Sender<Result<String>>,
        ) -> StartFuture
        + Send
        + Sync,
>;

pub(crate) const SAME_TASK_RECOVERY_LIMIT: usize = 3;

impl PersistentCopilotRunner {
    pub fn new(config: CopilotConfig) -> Self {
        Self {
            config,
            agents: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn evict(&self, worker_id: &str, entry: &Arc<AgentEntry>) {
        evict_entry(&self.agents, worker_id, entry).await;
    }

    async fn execute(&self, request: RunRequest) -> Result<AgentOutput> {
        self.execute_with(
            request,
            Arc::new(|config, root, worker, session_id, jobs, ready| {
                Box::pin(acp_process::run(
                    config, root, worker, session_id, jobs, ready,
                ))
            }),
        )
        .await
    }

    async fn execute_with(
        &self,
        mut request: RunRequest,
        start: StartAgent,
    ) -> Result<AgentOutput> {
        let mut recoveries = 0;
        loop {
            let mut cancellation = request.cancellation.clone();
            let attempt_start = start.clone();
            let ready = tokio::select! {
                ready = self.ensure_with(
                    request.project_root.clone(),
                    request.worker.clone(),
                    request.session_id.clone(),
                    move |config, root, worker, session_id, jobs, ready| {
                        attempt_start(config, root, worker, session_id, jobs, ready)
                    },
                ) => match ready {
                    Ok(ready) => ready,
                    Err(error) => {
                        if retry_same_task(&error, recoveries) {
                            recoveries += 1;
                            request.session_id.clear();
                            continue;
                        }
                        return Err(error);
                    }
                },
                _ = wait_for_cancellation(&mut cancellation) => {
                    return Err(anyhow!("agent run cancelled"));
                }
            };
            persist_session(&request, &ready.handle).await?;
            let prompt = prompt_for_session(&request, &ready.handle);
            request.session_id.clone_from(&ready.handle.session_id);
            let result = send_job(&ready.handle, prompt, request.cancellation.clone()).await;
            if result.is_ok() {
                return result;
            }

            if *request.cancellation.borrow() && cleanly_cancelled(&result) {
                return result;
            }
            self.evict(&request.worker.id, &ready.entry).await;
            let error = result.unwrap_err();
            if requires_fresh_session(&error) {
                tracing::warn!(
                    agent = %request.worker.id,
                    %error,
                    "discarding broken persistent Copilot session"
                );
                set_session(&request, "").await?;
                let store = crate::store::Store::open(
                    &request
                        .project_root
                        .join(".cairn-harness")
                        .join("harness.db"),
                )
                .await?;
                store
                    .record_runtime_event(
                        "session_rotated",
                        "warning",
                        Some(&request.worker.id),
                        None,
                        Some(&request.session_id),
                        &format!("{error:#}"),
                    )
                    .await?;
                request.session_id.clear();
            }
            if retry_same_task(&error, recoveries) {
                recoveries += 1;
                continue;
            }
            return Err(error);
        }
    }
}

fn prompt_for_session(request: &RunRequest, handle: &AgentHandle) -> String {
    if request.session_id != handle.session_id {
        request
            .fresh_session_prompt
            .clone()
            .unwrap_or_else(|| request.prompt.clone())
    } else {
        request.prompt.clone()
    }
}

impl AgentRunner for PersistentCopilotRunner {
    fn waits_for_terminal_stop(&self) -> bool {
        true
    }

    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(self.execute(request))
    }
}

#[cfg(test)]
#[path = "persistent_runner_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "persistent_runner_startup_tests.rs"]
mod startup_tests;
