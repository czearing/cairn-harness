use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct WorkerSpec {
    pub id: String,
    pub role: String,
    pub description: String,
    pub prompt: String,
}

impl WorkerSpec {
    pub fn name(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentState {
    pub agent_id: String,
    pub role: String,
    pub session_id: String,
    pub status: String,
    pub current_topic: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct Message {
    pub id: String,
    pub sender: String,
    pub recipient: String,
    pub topic: String,
    pub body: String,
    pub attempts: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OutgoingMessage {
    pub to: String,
    pub topic: String,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentOutput {
    pub summary: String,
    #[serde(default)]
    pub deliverable: Option<String>,
    #[serde(default)]
    pub messages: Vec<OutgoingMessage>,
    #[serde(default)]
    pub complete: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct TranscriptEntry {
    pub sequence: i64,
    pub agent_id: String,
    pub session_id: String,
    pub inbound_sender: String,
    pub inbound_topic: String,
    pub inbound_body: String,
    pub prompt: String,
    pub output: AgentOutput,
    pub status: String,
    pub started_at: String,
    pub completed_at: String,
}

#[derive(Clone, Debug)]
pub struct RunRequest {
    pub project_root: PathBuf,
    pub worker: WorkerSpec,
    pub session_id: String,
    pub prompt: String,
}

impl AgentOutput {
    pub fn is_actionable(&self) -> bool {
        (self.complete || !self.messages.is_empty()) && !self.uses_em_dash()
    }

    fn uses_em_dash(&self) -> bool {
        self.summary.contains('\u{2014}')
            || self
                .deliverable
                .as_ref()
                .is_some_and(|value| value.contains('\u{2014}'))
            || self.messages.iter().any(|message| {
                message.topic.contains('\u{2014}')
                    || message.body.contains('\u{2014}')
                    || message.to.contains('\u{2014}')
            })
    }
}
