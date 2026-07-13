use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::models::WorkerSpec;

#[derive(Clone, Debug, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    pub root: PathBuf,
    #[serde(default = "default_state_dir")]
    pub state_dir: PathBuf,
    pub team: TeamConfig,
    #[serde(default)]
    pub copilot: CopilotConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TeamConfig {
    pub max_agents: usize,
    pub max_concurrency: usize,
    #[serde(default = "default_runs")]
    pub max_runs_per_start: usize,
    #[serde(default = "default_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_lease_ms")]
    pub claim_lease_ms: u64,
    #[serde(default = "default_poll_ms")]
    pub poll_interval_ms: u64,
    pub roles: Vec<RoleConfig>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RoleConfig {
    pub name: String,
    #[serde(default = "one")]
    pub instances: usize,
    #[serde(default)]
    pub owns: Vec<String>,
    pub contract: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CopilotConfig {
    #[serde(default = "default_executable")]
    pub executable: PathBuf,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub model: Option<String>,
    #[serde(default = "default_continues")]
    pub max_autopilot_continues: u32,
    #[serde(default = "default_credits")]
    pub max_ai_credits: f32,
    #[serde(default = "enabled")]
    pub allow_all_tools: bool,
    #[serde(default = "enabled")]
    pub include_mcp_instructions: bool,
    #[serde(default = "default_denied_tools")]
    pub denied_tools: Vec<String>,
    pub additional_mcp_config: Option<PathBuf>,
}

impl ProjectConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let text = fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let mut config: Self = serde_json::from_str(&text)?;
        let base = path.parent().unwrap_or_else(|| Path::new("."));
        if config.root.is_relative() {
            config.root = base.join(&config.root);
        }
        config.validate()?;
        Ok(config)
    }

    pub fn workers(&self) -> Vec<WorkerSpec> {
        self.team
            .roles
            .iter()
            .flat_map(|role| {
                (1..=role.instances).map(move |index| WorkerSpec {
                    id: if role.instances == 1 {
                        role.name.clone()
                    } else {
                        format!("{}-{index}", role.name)
                    },
                    role: role.name.clone(),
                    contract: role.contract.clone(),
                    owns: role.owns.clone(),
                })
            })
            .collect()
    }

    pub fn database_path(&self) -> PathBuf {
        self.root.join(&self.state_dir).join("harness.db")
    }

    fn validate(&self) -> Result<()> {
        let workers = self.workers();
        if workers.is_empty() {
            bail!("team must contain at least one agent");
        }
        if workers.len() > self.team.max_agents {
            bail!("configured agents exceed team.max_agents");
        }
        if self.team.max_concurrency == 0 || self.team.max_concurrency > self.team.max_agents {
            bail!("team.max_concurrency must be between 1 and max_agents");
        }
        if self.team.roles.iter().any(|role| role.instances == 0) {
            bail!("role instances must be greater than zero");
        }
        if self.team.max_runs_per_start == 0 || self.team.max_attempts == 0 {
            bail!("team run and retry limits must be greater than zero");
        }
        if self.team.claim_lease_ms <= self.team.poll_interval_ms {
            bail!("team.claim_lease_ms must exceed poll_interval_ms");
        }
        Ok(())
    }
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self {
            executable: default_executable(),
            arguments: Vec::new(),
            model: None,
            max_autopilot_continues: default_continues(),
            max_ai_credits: default_credits(),
            allow_all_tools: true,
            include_mcp_instructions: true,
            denied_tools: default_denied_tools(),
            additional_mcp_config: None,
        }
    }
}

fn default_state_dir() -> PathBuf {
    ".cairn-harness".into()
}
fn default_executable() -> PathBuf {
    "copilot".into()
}
fn default_poll_ms() -> u64 {
    100
}
fn default_runs() -> usize {
    100
}
fn default_attempts() -> u32 {
    3
}
fn default_lease_ms() -> u64 {
    60_000
}
fn default_continues() -> u32 {
    5
}
fn default_credits() -> f32 {
    10.0
}
fn one() -> usize {
    1
}
fn enabled() -> bool {
    true
}
fn default_denied_tools() -> Vec<String> {
    vec![
        "shell(git push)".into(),
        "shell(git reset --hard)".into(),
        "shell(git clean:*)".into(),
    ]
}
