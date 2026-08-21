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

/// A stop hook can block a turn for a reason the agent is unable to satisfy, so
/// re-prompting is bounded; an unsatisfiable reason otherwise repeats forever.
pub(crate) const BLOCKED_REPROMPT_LIMIT: usize = 3;

pub(crate) async fn read(
    session: &mut agent_client_protocol::ActiveSession<'_, Agent>,
    signal: &mut TurnSignal,
    live: &mut LiveResponse,
    mut start: u64,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<AgentResponse> {
    let mut output = String::new();
    let mut committed = 0usize;
    let mut tools = Vec::new();
    let mut blocks = 0usize;
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
                            if blocks >= BLOCKED_REPROMPT_LIMIT {
                                tracing::warn!(
                                    blocks,
                                    %reason,
                                    "abandoning turn after repeated stop-hook blocks"
                                );
                                return Ok(response(text, event_tools, output, tools));
                            }
                            blocks += 1;
                            output.clear();
                            committed = 0;
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
                                apply_update(notification.update, &mut output, &mut committed, &mut tools, live);
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
    committed: &mut usize,
    tools: &mut Vec<String>,
    live: &mut LiveResponse,
) {
    match update {
        SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => {
            if append_text(output, *committed, &text.text)
                && let Err(error) = live.publish(output)
            {
                tracing::warn!(%error, "could not publish live response");
            }
        }
        SessionUpdate::ToolCall(call) => {
            if let Err(error) = live.flush(output) {
                tracing::warn!(%error, "could not flush live response");
            }
            end_message(output, committed);
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

fn append_text(output: &mut String, committed: usize, chunk: &str) -> bool {
    let current = &output[committed..];
    if chunk.is_empty() || chunk == current || (chunk.len() >= 8 && current.ends_with(chunk)) {
        return false;
    }
    if chunk.starts_with(current) {
        output.truncate(committed);
    }
    output.push_str(chunk);
    true
}

/// Closes the message in progress so the next one is not glued onto its last
/// word; without it two separate replies render as a single run-on string.
fn end_message(output: &mut String, committed: &mut usize) {
    if output.len() > *committed {
        output.push_str("\n\n");
    }
    *committed = output.len();
}

#[cfg(test)]
mod tests {
    use super::{append_text, end_message};

    #[test]
    fn accepts_delta_and_cumulative_chunks_without_repeating_text() {
        let mut output = String::new();
        assert!(append_text(&mut output, 0, "CURRENT"));
        assert!(append_text(&mut output, 0, "CURRENT STREAM"));
        assert!(append_text(&mut output, 0, " START."));
        assert!(!append_text(&mut output, 0, "CURRENT STREAM START."));
        assert_eq!(output, "CURRENT STREAM START.");
    }

    #[test]
    fn separates_messages_instead_of_running_them_together() {
        let mut output = String::new();
        let mut committed = 0usize;

        assert!(append_text(&mut output, committed, "BRAIN_OK 4"));
        end_message(&mut output, &mut committed);
        assert!(append_text(&mut output, committed, "BRAIN_OK 4"));

        assert_eq!(output, "BRAIN_OK 4\n\nBRAIN_OK 4");
    }

    #[test]
    fn deduplicates_within_a_message_after_an_earlier_one_committed() {
        let mut output = String::new();
        let mut committed = 0usize;

        assert!(append_text(&mut output, committed, "First reply."));
        end_message(&mut output, &mut committed);
        assert!(append_text(&mut output, committed, "Second"));
        assert!(append_text(&mut output, committed, "Second reply."));

        assert_eq!(output, "First reply.\n\nSecond reply.");
    }

    #[test]
    fn a_boundary_without_new_text_adds_no_separator() {
        let mut output = String::new();
        let mut committed = 0usize;

        end_message(&mut output, &mut committed);
        end_message(&mut output, &mut committed);

        assert!(output.is_empty());
        assert_eq!(committed, 0);
    }
}
