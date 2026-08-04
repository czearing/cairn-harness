use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, ContentChunk, SessionNotification, SessionUpdate,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{Agent, SessionMessage};
use anyhow::{Result, bail};
use tokio::sync::watch;

use crate::{
    live_response::LiveResponse,
    runner::wait_for_cancellation,
    turn_signal::{TurnEvents, TurnSignal, TurnStop},
};

pub(crate) struct AgentResponse {
    pub text: String,
    pub tools: Vec<String>,
}

pub(crate) async fn read(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    signal: &mut TurnSignal,
    live: &mut LiveResponse,
    mut start: u64,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<AgentResponse> {
    let mut output = String::new();
    let mut tools = Vec::new();
    loop {
        tokio::select! {
            update = session.read_update() => {
                match update? {
                    SessionMessage::StopReason(_) => {
                        let TurnEvents { text, tools: event_tools, stop, .. } = tokio::select! {
                            events = signal.wait_terminal_after(start) => events?,
                            _ = wait_for_cancellation(cancellation) => bail!("agent run cancelled"),
                        };
                        if let TurnStop::Blocked(reason) = stop {
                            output.clear();
                            tools.clear();
                            clear_blocked(live);
                            start = signal.position();
                            session.send_prompt(reason)?;
                            continue;
                        }
                        return Ok(response(text, event_tools, output, tools));
                    }
                    SessionMessage::SessionMessage(dispatch) => {
                        MatchDispatch::new(dispatch)
                            .if_notification(async |notification: SessionNotification| {
                                apply_update(notification.update, &mut output, &mut tools, live);
                                Ok(())
                            })
                            .await
                            .otherwise_ignore()?;
                    }
                    _ => {}
                }
            }
            events = signal.wait_after(start, crate::protocol::END) => {
                let TurnEvents { text, tools: event_tools, .. } = events?;
                cancel_and_drain(session).await?;
                return Ok(response(text, event_tools, output, tools));
            }
            _ = wait_for_cancellation(cancellation) => {
                cancel_and_drain(session).await?;
                bail!("agent run cancelled");
            }
        }
    }
}

fn apply_update(
    update: SessionUpdate,
    output: &mut String,
    tools: &mut Vec<String>,
    live: &mut LiveResponse,
) {
    match update {
        SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => {
            if append_text(output, &text.text)
                && let Err(error) = live.publish(output)
            {
                tracing::warn!(%error, "could not publish live response");
            }
        }
        SessionUpdate::ToolCall(call) => {
            if let Err(error) = live.flush(output) {
                tracing::warn!(%error, "could not flush live response");
            }
            tools.push(call.title);
        }
        _ => {}
    }
}

fn response(
    event_text: String,
    event_tools: Vec<String>,
    text: String,
    tools: Vec<String>,
) -> AgentResponse {
    AgentResponse {
        text: if event_text.is_empty() {
            text
        } else {
            event_text
        },
        tools: if event_tools.is_empty() {
            tools
        } else {
            event_tools
        },
    }
}

fn clear_blocked(live: &mut LiveResponse) {
    if let Err(error) = live.clear() {
        tracing::warn!(%error, "could not clear blocked live response");
    }
}

async fn cancel_and_drain(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
) -> Result<()> {
    cancel(session)?;
    loop {
        if matches!(session.read_update().await?, SessionMessage::StopReason(_)) {
            return Ok(());
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

fn append_text(output: &mut String, chunk: &str) -> bool {
    if chunk.is_empty() || chunk == output || (chunk.len() >= 8 && output.ends_with(chunk)) {
        return false;
    }
    if chunk.starts_with(output.as_str()) {
        output.clear();
    }
    output.push_str(chunk);
    true
}

#[cfg(test)]
mod tests {
    use super::append_text;

    #[test]
    fn accepts_delta_and_cumulative_chunks_without_repeating_text() {
        let mut output = String::new();
        assert!(append_text(&mut output, "CURRENT"));
        assert!(append_text(&mut output, "CURRENT STREAM"));
        assert!(append_text(&mut output, " START."));
        assert!(!append_text(&mut output, "CURRENT STREAM START."));
        assert_eq!(output, "CURRENT STREAM START.");
    }
}
