mod acp_process;
mod acp_session;
pub mod config;
pub mod directory;
mod handoff;
mod mailbox;
pub mod models;
pub mod orchestrator;
mod persistent_runner;
pub mod policy;
mod producer;
mod project_config;
pub mod prompt;
pub mod protocol;
mod release;
mod release_store;
pub mod runner;
mod shell_command;
pub mod store;
mod todo;
mod todo_store;
pub mod transcript;
mod transcript_store;
mod turn;
mod watch;
mod work_item;
mod work_item_store;
mod worker;

use std::{path::Path, sync::Arc};

use anyhow::Result;
use config::ProjectConfig;
use orchestrator::Harness;
use persistent_runner::PersistentCopilotRunner;
use runner::AgentRunner;
use store::Store;

pub async fn open(config_path: &Path) -> Result<Harness> {
    let config = ProjectConfig::load(config_path)?;
    let store = Store::open(&config.database_path()).await?;
    let runner: Arc<dyn AgentRunner> =
        Arc::new(PersistentCopilotRunner::new(config.copilot.clone()));
    Ok(Harness::new(config, store, runner))
}
