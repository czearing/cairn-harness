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
    pub composed: crate::prompt::Composed,
    pub prior_context: Option<String>,
    pub delivered: DeliveredPrompt,
    pub cancellation: tokio::sync::watch::Receiver<bool>,
}

impl RunRequest {
    /// Everything the agent would need without a retained session.
    pub fn full_prompt(&self) -> String {
        let prompt = self.composed.full();
        match &self.prior_context {
            Some(context) => crate::prompt::with_prior_context(&prompt, context),
            None => prompt,
        }
    }
}

/// Out-parameter carrying the exact bytes a runner delivered back to the caller.
///
/// `turns.prompt` is the only durable record of what an agent actually received,
/// and once sections are withheld from a continuing session the composed prompt
/// is no longer that record. Returning it through `AgentOutput` was rejected
/// because that struct is deserialized from agent JSON and is built in dozens of
/// tests; a shared cell keeps the change to the request that already travels the
/// same path.
#[derive(Clone, Debug, Default)]
pub struct DeliveredPrompt(std::sync::Arc<std::sync::Mutex<Option<String>>>);

impl DeliveredPrompt {
    pub fn record(&self, prompt: &str) {
        *self.0.lock().expect("delivered prompt lock") = Some(prompt.to_string());
    }

    pub fn get(&self) -> Option<String> {
        self.0.lock().expect("delivered prompt lock").clone()
    }
}

impl AgentOutput {
    pub fn is_waiting(&self) -> bool {
        !self.complete
    }
}
