use std::path::PathBuf;

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectConfig {
    pub name: String,
    pub root: PathBuf,
    pub leader: Option<String>,
    pub producer: Option<String>,
    #[serde(default = "default_todo_dir")]
    pub todo_dir: PathBuf,
    pub roles: Vec<RoleConfig>,
    #[serde(default)]
    pub copilot: CopilotConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoleConfig {
    pub name: String,
    pub description: String,
    pub prompt: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CopilotConfig {
    #[serde(default = "default_executable")]
    pub executable: PathBuf,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub model: Option<String>,
    pub additional_mcp_config: Option<PathBuf>,
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self {
            executable: default_executable(),
            arguments: Vec::new(),
            model: Some("gpt-5.4-mini".into()),
            additional_mcp_config: None,
        }
    }
}

fn default_todo_dir() -> PathBuf {
    "todos".into()
}
fn default_executable() -> PathBuf {
    "copilot".into()
}
