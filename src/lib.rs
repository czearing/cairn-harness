pub mod config;
pub mod directory;
mod mailbox;
pub mod models;
pub mod orchestrator;
pub mod prompt;
pub mod protocol;
pub mod runner;
pub mod store;
mod worker;

use std::{path::Path, sync::Arc};

use anyhow::Result;
use config::ProjectConfig;
use orchestrator::Harness;
use runner::{AgentRunner, CopilotRunner};
use store::Store;

pub async fn open(config_path: &Path) -> Result<Harness> {
    let config = ProjectConfig::load(config_path)?;
    let store = Store::open(&config.database_path()).await?;
    let runner: Arc<dyn AgentRunner> = Arc::new(CopilotRunner::new(config.copilot.clone()));
    Ok(Harness::new(config, store, runner))
}
