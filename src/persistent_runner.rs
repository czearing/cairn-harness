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
    /// Text of each prompt section as last delivered on this entry's session.
    ///
    /// In-memory is sufficient and correct: an entry is evicted whenever the
    /// session rotates or a job fails, and a harness restart drops the map and
    /// starts a new session together, so the map can never claim an agent was
    /// told something the live session has not seen.
    pub(crate) delivered_sections: std::sync::Mutex<HashMap<String, String>>,
    /// Text of each assignment body as last delivered on this entry's session, by task id.
    ///
    /// A map, not one slot: an interrupting message is delivered between a preempted
    /// assignment and its re-claim, so a single slot is overwritten by the interrupter
    /// and the resumed assignment no longer recognises itself.
    pub(crate) delivered_body: std::sync::Mutex<HashMap<String, String>>,
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
            let prompt = prompt_for_session(&request, &ready.handle, &ready.entry);
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

fn prompt_for_session(request: &RunRequest, handle: &AgentHandle, entry: &AgentEntry) -> String {
    let fresh = request.session_id != handle.session_id;
    let mut delivered = entry
        .delivered_sections
        .lock()
        .expect("delivered sections lock");
    let mut delivered_body = entry.delivered_body.lock().expect("delivered body lock");
    if fresh {
        delivered.clear();
        delivered_body.clear();
    }
    // A preempted turn is claimed again with the same row and the same words. Sending
    // that body once more makes the agent answer the operator twice, so it is replaced
    // by a resume line. Identity and text must both match: a rebuilt body that gained
    // child results or a changed assignment is genuinely new and is sent in full.
    let repeated = request.composed.body_key.as_ref().is_some_and(|key| {
        delivered_body
            .get(key)
            .is_some_and(|sent| sent == &request.composed.body)
    });
    let body = if repeated {
        crate::prompt::RESUMED_BODY
    } else {
        if let Some(key) = &request.composed.body_key {
            delivered_body.insert(key.clone(), request.composed.body.clone());
        }
        request.composed.body.as_str()
    };
    let prompt = request.composed.render_body(
        |section| {
            if delivered
                .get(section.key)
                .is_some_and(|sent| sent == &section.text)
            {
                return false;
            }
            delivered.insert(section.key.to_string(), section.text.clone());
            true
        },
        body,
    );
    let prompt = match (&request.prior_context, fresh) {
        (Some(context), true) => crate::prompt::with_prior_context(&prompt, context),
        _ => prompt,
    };
    request.delivered.record(&prompt);
    prompt
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
