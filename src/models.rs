use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct WorkerSpec {
    pub id: String,
    pub role: String,
    pub description: String,
    pub prompt: String,
    pub model: String,
    pub leader: String,
    pub leader_task_limit: u64,
    pub idea_agents: Vec<String>,
    pub delegate_agents: Vec<String>,
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
pub struct Assignment {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub source: String,
    pub creator: String,
    pub assignee: String,
    pub topic: String,
    pub body: String,
    pub attempts: u32,
    pub claim_generation: i64,
}

impl Assignment {
    pub fn is_message(&self) -> bool {
        self.kind == "message" || self.source == "message"
    }

    pub fn is_peer_message(&self) -> bool {
        self.kind == "message" && self.source == "agent"
    }

    pub fn is_dashboard_message(&self) -> bool {
        self.kind == "message" && self.source == "message" && self.creator == "dashboard"
    }
}

#[derive(Clone, Debug)]
pub struct ChildResult {
    pub assignee: String,
    pub topic: String,
    pub status: String,
    pub result: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentOutput {
    pub summary: String,
    #[serde(default)]
    pub deliverable: Option<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub complete: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct TranscriptEntry {
    pub sequence: i64,
    pub agent_id: String,
    pub session_id: String,
    pub inbound_creator: String,
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
    pub fresh_session_prompt: Option<String>,
    pub cancellation: tokio::sync::watch::Receiver<bool>,
}

impl AgentOutput {
    pub fn is_waiting(&self) -> bool {
        !self.complete
    }
}
