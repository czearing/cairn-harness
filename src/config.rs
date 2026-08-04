use std::path::PathBuf;

use serde::{Deserialize, Deserializer};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectConfig {
    pub name: String,
    pub root: PathBuf,
    #[serde(skip)]
    pub paused: bool,
    #[serde(default)]
    pub configuration_revision: u64,
    #[serde(default)]
    pub agent_deletion_operations: Vec<AgentDeletionOperationConfig>,
    pub leader: Option<String>,
    pub leader_task_limit: Option<u64>,
    pub max_active_tasks: Option<u64>,
    #[serde(default)]
    pub idea_agents: Vec<IdeaAgentConfig>,
    // Legacy single-producer fields remain readable for existing projects.
    pub producer: Option<String>,
    pub producer_limit: Option<u64>,
    pub producer_prompt: Option<String>,
    #[serde(default = "default_producer_retry_cooldown_seconds")]
    pub producer_retry_cooldown_seconds: u64,
    pub work_dir: Option<PathBuf>,
    #[serde(default)]
    pub roles: Vec<RoleConfig>,
    #[serde(default)]
    pub copilot: CopilotConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdeaAgentConfig {
    pub agent: String,
    pub task_limit: u64,
    pub prompt: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoleConfig {
    pub name: String,
    #[serde(default)]
    pub agent_kind: Option<String>,
    #[serde(default)]
    pub source_agent: Option<String>,
    #[serde(default)]
    pub instance_ordinal: Option<u32>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub replica_eligible: bool,
    pub description: String,
    pub prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub appearance: Option<AgentAppearanceConfig>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentAppearanceConfig {
    pub color: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentDeletionOperationConfig {
    pub id: String,
    #[serde(alias = "idempotencyKey")]
    pub idempotency_key: String,
    #[serde(alias = "targetId")]
    pub target_id: String,
    #[serde(alias = "targetKind")]
    pub target_kind: String,
    #[serde(alias = "affectedIds")]
    pub affected_ids: Vec<String>,
    pub state: String,
    pub revision: u64,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CopilotConfig {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub model: Option<String>,
    pub additional_mcp_config: Option<PathBuf>,
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self {
            executable: default_executable(),
            arguments: Vec::new(),
            model: None,
            additional_mcp_config: None,
        }
    }
}

impl<'de> Deserialize<'de> for CopilotConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            #[serde(default = "default_executable")]
            executable: PathBuf,
            #[serde(default)]
            arguments: Vec<String>,
            model: Option<String>,
            additional_mcp_config: Option<PathBuf>,
            #[serde(default)]
            startup_timeout_ms: Option<serde::de::IgnoredAny>,
        }

        let wire = Wire::deserialize(deserializer)?;
        let _ = wire.startup_timeout_ms;
        Ok(Self {
            executable: wire.executable,
            arguments: wire.arguments,
            model: wire.model,
            additional_mcp_config: wire.additional_mcp_config,
        })
    }
}

fn default_producer_retry_cooldown_seconds() -> u64 {
    86_400
}

fn default_executable() -> PathBuf {
    "copilot".into()
}
