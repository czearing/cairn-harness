use agent_client_protocol::Agent;
use anyhow::{Result, bail};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Duration, Instant, timeout};

use crate::{
    live_response::LiveResponse, models::WorkerSpec, persistent_runner::Job,
    protocol::parse_output, turn_signal::TurnSignal,
};

pub async fn serve(
    mut session: agent_client_protocol::ActiveSession<'_, Agent>,
    root: std::path::PathBuf,
    worker: WorkerSpec,
    mut jobs: mpsc::Receiver<Job>,
    ready: oneshot::Sender<Result<String>>,
) -> Result<(), agent_client_protocol::Error> {
    let session_id = session.session_id().to_string();
    let mut live = LiveResponse::new(&root, &worker.id, &session_id);
    let mut signal = TurnSignal::new(root.clone(), &worker.id, &session_id)
        .map_err(agent_client_protocol::util::internal_error)?;
    let _ = ready.send(Ok(session.session_id().to_string()));
    while let Some(job) = jobs.recv().await {
        let result = prompt(
            &mut session,
            &mut signal,
            &mut live,
            &root,
            &worker.id,
            job.prompt,
            job.cancellation,
        )
        .await;
        let _ = job.response.send(result);
    }

    Ok(())
}

async fn prompt(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    signal: &mut TurnSignal,
    live: &mut LiveResponse,
    root: &std::path::Path,
    worker_id: &str,
    prompt: String,
    mut cancellation: watch::Receiver<bool>,
) -> Result<crate::models::AgentOutput> {
    if let Err(error) = live.clear() {
        tracing::warn!(%error, "could not clear stale live response");
    }
    if *cancellation.borrow() {
        bail!("agent run cancelled");
    }
    drain_pending(session).await?;
    let start = signal.position();
    session.send_prompt(prompt)?;
    tracing::info!("Copilot agent started responding");
    let response = crate::acp_response::read(session, signal, live, start, &mut cancellation).await;
    if let Err(error) = live.clear() {
        tracing::warn!(%error, "could not clear completed live response");
    }
    let response = response?;
    let mut output = parse_output(&response.text)?;
    output.tools = response.tools;
    if output.complete {
        require_cairn_receipt(root, worker_id, &session.session_id().to_string())?;
    }
    Ok(output)
}

fn require_cairn_receipt(root: &std::path::Path, worker_id: &str, session_id: &str) -> Result<()> {
    let path = root
        .join(".cairn-harness")
        .join("copilot-home")
        .join(worker_id)
        .join("session-state")
        .join(session_id)
        .join("cairn-compliance.json");
    let receipt = std::fs::read_to_string(&path).map_err(|_| {
        anyhow::anyhow!("Cairn workflow certification failed: compliance receipt is missing")
    })?;
    let receipt: serde_json::Value = serde_json::from_str(&receipt).map_err(|_| {
        anyhow::anyhow!("Cairn workflow certification failed: compliance receipt is invalid")
    })?;
    if receipt["sessionId"].as_str() != Some(session_id)
        || receipt["rootNodeId"].as_str().is_none_or(str::is_empty)
    {
        bail!(
            "Cairn workflow certification failed: compliance receipt does not match the terminal session"
        );
    }
    Ok(())
}

async fn drain_pending(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(());
        }
        match timeout(
            remaining.min(Duration::from_millis(25)),
            session.read_update(),
        )
        .await
        {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => return Err(error.into()),
            Err(_) => return Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::require_cairn_receipt;
    use tempfile::tempdir;

    #[test]
    fn terminal_output_requires_a_matching_cairn_receipt() {
        let temp = tempdir().unwrap();
        let directory = temp
            .path()
            .join(".cairn-harness/copilot-home/reviewer/session-state/session-1");
        std::fs::create_dir_all(&directory).unwrap();
        assert!(require_cairn_receipt(temp.path(), "reviewer", "session-1").is_err());
        std::fs::write(
            directory.join("cairn-compliance.json"),
            r#"{"sessionId":"session-1","rootNodeId":"root-1"}"#,
        )
        .unwrap();
        require_cairn_receipt(temp.path(), "reviewer", "session-1").unwrap();
    }
}
