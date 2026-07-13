use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct WorkerSpec {
    pub id: String,
    pub role: String,
    pub contract: String,
    pub owns: Vec<String>,
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
    pub messages: Vec<OutgoingMessage>,
    #[serde(default)]
    pub complete: bool,
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
        self.complete || !self.messages.is_empty()
    }
}
