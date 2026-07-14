use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, ContentChunk, SessionNotification, SessionUpdate,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{Agent, SessionMessage};
use anyhow::Result;
use tokio::sync::{mpsc, oneshot};

use crate::{
    models::WorkerSpec,
    persistent_runner::Job,
    protocol::parse_output,
    turn_signal::{TurnEvents, TurnSignal},
};

pub async fn serve(
    mut session: agent_client_protocol::ActiveSession<'_, Agent>,
    root: std::path::PathBuf,
    worker: WorkerSpec,
    mut jobs: mpsc::Receiver<Job>,
    ready: oneshot::Sender<Result<String>>,
    loaded: bool,
) -> Result<(), agent_client_protocol::Error> {
    let session_id = session.session_id().to_string();
    let mut signal = TurnSignal::new(root, &worker.id, &session_id)
        .map_err(agent_client_protocol::util::internal_error)?;
    if loaded {
        synchronize(&mut session, &mut signal).await?;
    }
    let _ = ready.send(Ok(session.session_id().to_string()));
    while let Some(job) = jobs.recv().await {
        let result = prompt(&mut session, &mut signal, job.prompt).await;
        let _ = job.response.send(result);
    }
    Ok(())
}

async fn prompt(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    signal: &mut TurnSignal,
    prompt: String,
) -> Result<crate::models::AgentOutput> {
    let start = signal.position();
    session.send_prompt(prompt)?;
    tracing::info!("Copilot agent started responding");
    let response = read_response(session, signal, start).await?;
    let mut output = parse_output(&response.text)?;
    output.tools = response.tools;
    Ok(output)
}

async fn synchronize(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    signal: &mut TurnSignal,
) -> Result<(), agent_client_protocol::Error> {
    let start = signal.position();
    session.send_prompt(
        "<system-reminder>Reply with exactly HARNESS_SESSION_READY.</system-reminder>",
    )?;
    loop {
        tokio::select! {
            update = session.read_update() => {
                if matches!(update?, SessionMessage::StopReason(_)) {
                    signal.wait_after(start, "HARNESS_SESSION_READY")
                        .await
                        .map_err(agent_client_protocol::util::internal_error)?;
                    cancel(session)?;
                    return Ok(());
                }
            }
            events = signal.wait_after(start, "HARNESS_SESSION_READY") => {
                events.map_err(agent_client_protocol::util::internal_error)?;
                cancel(session)?;
                return Ok(());
            }
        }
    }
}

async fn read_response(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    signal: &mut TurnSignal,
    start: u64,
) -> Result<AgentResponse> {
    let mut output = String::new();
    let mut tools = Vec::new();
    loop {
        tokio::select! {
            update = session.read_update() => {
                match update? {
                    SessionMessage::StopReason(_) => {
                        let TurnEvents { text, tools: event_tools } =
                            signal.wait_after(start, crate::protocol::END).await?;
                        cancel(session)?;
                        return Ok(AgentResponse {
                            text: if text.is_empty() { output } else { text },
                            tools: if event_tools.is_empty() { tools } else { event_tools },
                        });
                    }
                    SessionMessage::SessionMessage(dispatch) => {
                        MatchDispatch::new(dispatch)
                            .if_notification(async |notification: SessionNotification| {
                                match notification.update {
                                    SessionUpdate::AgentMessageChunk(ContentChunk {
                                        content: ContentBlock::Text(text), ..
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
            }
            events = signal.wait_after(start, crate::protocol::END) => {
                let TurnEvents { text, tools: event_tools } = events?;
                cancel(session)?;
                return Ok(AgentResponse {
                    text: if text.is_empty() { output } else { text },
                    tools: if event_tools.is_empty() { tools } else { event_tools },
                });
            }
        }
    }
}

fn cancel(
    session: &agent_client_protocol::ActiveSession<'_, Agent>,
) -> Result<(), agent_client_protocol::Error> {
    session
        .connection()
        .send_notification_to(Agent, CancelNotification::new(session.session_id().clone()))
}

struct AgentResponse {
    text: String,
    tools: Vec<String>,
}
