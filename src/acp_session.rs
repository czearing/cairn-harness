use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, SessionNotification, SessionUpdate,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{Agent, SessionMessage};
use anyhow::{Context, Result};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Duration, timeout};

use crate::{models::WorkerSpec, persistent_runner::Job, protocol::parse_output};

pub async fn serve(
    mut session: agent_client_protocol::ActiveSession<'_, Agent>,
    worker: WorkerSpec,
    mut jobs: mpsc::Receiver<Job>,
    ready: oneshot::Sender<Result<String>>,
    loaded: bool,
) -> Result<(), agent_client_protocol::Error> {
    if loaded {
        drain_replay(&mut session).await?;
    } else {
        session.send_prompt(format!(
            "Role: {}. {}. {} Reply READY only.",
            worker.name(),
            worker.description,
            worker.prompt
        ))?;
        let first = timeout(Duration::from_secs(10), session.read_update())
            .await
            .map_err(|_| acp_error("Copilot role startup produced no update"))??;
        tracing::info!("Copilot role startup started responding");
        read_response(&mut session, first)
            .await
            .map_err(|error| acp_error(&error.to_string()))?;
    }
    let _ = ready.send(Ok(session.session_id().to_string()));
    while let Some(job) = jobs.recv().await {
        let result = prompt(&mut session, job.prompt).await;
        let _ = job.response.send(result);
    }
    Ok(())
}

async fn prompt(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    prompt: String,
) -> Result<crate::models::AgentOutput> {
    session.send_prompt(prompt)?;
    let first = timeout(Duration::from_secs(10), session.read_update())
        .await
        .context("Copilot produced no update within 10 seconds")??;
    tracing::info!("Copilot agent started responding");
    let text = read_response(session, first).await?;
    parse_output(&text)
}

async fn drain_replay(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
) -> Result<(), agent_client_protocol::Error> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Ok(());
        }
        match timeout(Duration::from_millis(250), session.read_update()).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => return Ok(()),
        }
    }
}

async fn read_response(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    first: SessionMessage,
) -> Result<String> {
    let mut output = String::new();
    let mut update = first;
    loop {
        match update {
            SessionMessage::StopReason(_) => return Ok(output),
            SessionMessage::SessionMessage(dispatch) => {
                MatchDispatch::new(dispatch)
                    .if_notification(async |notification: SessionNotification| {
                        if let SessionUpdate::AgentMessageChunk(ContentChunk {
                            content: ContentBlock::Text(text),
                            ..
                        }) = notification.update
                        {
                            output.push_str(&text.text);
                        }
                        Ok(())
                    })
                    .await
                    .otherwise_ignore()?;
            }
            _ => {}
        }
        update = timeout(Duration::from_secs(60), session.read_update())
            .await
            .context("Copilot turn completion timed out")??;
    }
}

fn acp_error(message: &str) -> agent_client_protocol::Error {
    agent_client_protocol::Error::internal_error().data(message)
}
