use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, Result, anyhow};
use tokio::sync::{Mutex, oneshot, watch};

use crate::{
    models::{AgentOutput, RunRequest},
    persistent_runner::{
        AgentEntry, AgentHandle, Job, ReadyAgent, SAME_TASK_RECOVERY_LIMIT, StartupState,
    },
};

pub(crate) fn cleanly_cancelled(result: &Result<AgentOutput>) -> bool {
    result
        .as_ref()
        .err()
        .is_some_and(|error| format!("{error:#}") == "agent run cancelled")
}

pub(crate) fn reusable_for_session(
    entry: &AgentEntry,
    requested_session_id: &str,
    requested_model: &str,
) -> bool {
    if entry.requested_model != requested_model {
        return false;
    }
    match entry.state.borrow().clone() {
        StartupState::Pending => entry.requested_session_id == requested_session_id,
        StartupState::Ready(handle) => handle.session_id == requested_session_id,
        StartupState::Failed(_) => false,
    }
}

pub(crate) fn entry_session_id(entry: &AgentEntry) -> String {
    match entry.state.borrow().clone() {
        StartupState::Ready(handle) => handle.session_id,
        StartupState::Pending | StartupState::Failed(_) => entry.requested_session_id.clone(),
    }
}

pub(crate) async fn entry_is_current(
    agents: &Mutex<HashMap<String, Arc<AgentEntry>>>,
    worker_id: &str,
    entry: &Arc<AgentEntry>,
) -> bool {
    agents
        .lock()
        .await
        .get(worker_id)
        .is_some_and(|current| Arc::ptr_eq(current, entry))
}

pub(crate) async fn publish_ready_if_current(
    agents: &Mutex<HashMap<String, Arc<AgentEntry>>>,
    worker_id: &str,
    entry: &Arc<AgentEntry>,
    state: &watch::Sender<StartupState>,
    handle: AgentHandle,
) {
    let agents = agents.lock().await;
    if agents
        .get(worker_id)
        .is_some_and(|current| Arc::ptr_eq(current, entry))
    {
        state.send_replace(StartupState::Ready(handle));
    } else {
        state.send_replace(StartupState::Failed(
            "persistent Copilot startup was replaced".into(),
        ));
    }
}

pub(crate) async fn evict_entry(
    agents: &Mutex<HashMap<String, Arc<AgentEntry>>>,
    worker_id: &str,
    entry: &Arc<AgentEntry>,
) {
    let mut agents = agents.lock().await;
    let removed = if agents
        .get(worker_id)
        .is_some_and(|current| Arc::ptr_eq(current, entry))
    {
        agents.remove(worker_id)
    } else {
        None
    };
    drop(agents);
    if let Some(removed) = removed {
        removed.stop.send_replace(true);
    }
}

pub(crate) async fn wait_for_startup(entry: Arc<AgentEntry>) -> Result<ReadyAgent> {
    let mut state = entry.state.clone();
    loop {
        match state.borrow().clone() {
            StartupState::Pending => {}
            StartupState::Ready(handle) => return Ok(ReadyAgent { handle, entry }),
            StartupState::Failed(error) => return Err(anyhow!(error)),
        }
        state
            .changed()
            .await
            .context("Copilot ACP startup state channel closed")?;
    }
}

pub(crate) async fn persist_session(request: &RunRequest, handle: &AgentHandle) -> Result<()> {
    if request.session_id == handle.session_id {
        return Ok(());
    }
    set_session(request, &handle.session_id).await
}

pub(crate) async fn set_session(request: &RunRequest, session_id: &str) -> Result<()> {
    let store = crate::store::Store::open(
        &request
            .project_root
            .join(".cairn-harness")
            .join("harness.db"),
    )
    .await?;
    store.set_session(&request.worker.id, session_id).await
}

pub(crate) async fn clear_stopped_session(
    root: &std::path::Path,
    worker_id: &str,
    session_id: &str,
) -> Result<()> {
    let store = crate::store::Store::open(&root.join(".cairn-harness").join("harness.db")).await?;
    store.clear_session_if(worker_id, session_id).await
}

pub(crate) fn requires_fresh_session(error: &anyhow::Error) -> bool {
    let detail = format!("{error:#}");
    detail == "empty agent output"
        || detail.contains("Missing namespace for function_call")
        || detail.contains("Copilot session error")
        || detail.contains("Copilot ACP startup channel closed")
        || detail.contains("Cairn workflow certification failed")
        || detail.contains("persistent Copilot agent stopped")
        || detail.contains("persistent Copilot response channel closed")
        || detail.contains("Process exited with exit code")
        || (detail.contains("Internal error") && detail.contains("\"data\""))
}

pub(crate) fn retry_same_task(error: &anyhow::Error, recoveries: usize) -> bool {
    if recoveries >= SAME_TASK_RECOVERY_LIMIT {
        return false;
    }
    requires_fresh_session(error)
}

pub(crate) async fn send_job(
    handle: &AgentHandle,
    prompt: String,
    cancellation: watch::Receiver<bool>,
) -> Result<AgentOutput> {
    let (response, result) = oneshot::channel();
    handle
        .jobs
        .send(Job {
            prompt,
            response,
            cancellation,
        })
        .await
        .context("persistent Copilot agent stopped")?;
    result
        .await
        .context("persistent Copilot response channel closed")?
}
