use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, SessionNotification, SessionUpdate,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{Agent, SessionMessage};
use anyhow::Result;
use tokio::sync::{mpsc, oneshot};

use crate::{models::WorkerSpec, persistent_runner::Job, protocol::parse_output};

pub async fn serve(
    mut session: agent_client_protocol::ActiveSession<'_, Agent>,
    _worker: WorkerSpec,
    mut jobs: mpsc::Receiver<Job>,
    ready: oneshot::Sender<Result<String>>,
    loaded: bool,
) -> Result<(), agent_client_protocol::Error> {
    if loaded {
        synchronize(&mut session).await?;
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
    let first = session.read_update().await?;
    tracing::info!("Copilot agent started responding");
    let response = read_response(session, first).await?;
    let mut output = parse_output(&response.text)?;
    output.tools = response.tools;
    Ok(output)
}

async fn synchronize(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
) -> Result<(), agent_client_protocol::Error> {
    session.send_prompt(
        "<system-reminder>Reply with exactly HARNESS_SESSION_READY.</system-reminder>",
    )?;
    loop {
        if let SessionMessage::StopReason(_) = session.read_update().await? {
            return Ok(());
        }
    }
}

async fn read_response(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    first: SessionMessage,
) -> Result<AgentResponse> {
    let mut output = String::new();
    let mut tools = Vec::new();
    let mut update = first;
    loop {
        match update {
            SessionMessage::StopReason(_) => {
                return Ok(AgentResponse {
                    text: output,
                    tools,
                });
            }
            SessionMessage::SessionMessage(dispatch) => {
                MatchDispatch::new(dispatch)
                    .if_notification(async |notification: SessionNotification| {
                        match notification.update {
                            SessionUpdate::AgentMessageChunk(ContentChunk {
                                content: ContentBlock::Text(text),
                                ..
                            }) => output.push_str(&text.text),
                            SessionUpdate::ToolCall(call) => tools.push(call.title),
                            _ => {}
                        }
                        Ok(())
                    })
                    .await
                    .otherwise_ignore()?;
            }

            _ => {}
        }

        update = session.read_update().await?;
    }
}

struct AgentResponse {
    text: String,
    tools: Vec<String>,
}
