use std::{collections::HashSet, fs};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::{
    config::{ProjectConfig, RoleConfig},
    models::WorkerSpec,
    worker::WorkerContext,
};

pub(crate) fn refresh_config(ctx: &mut WorkerContext) -> Result<()> {
    let Some(path) = &ctx.config_path else {
        return Ok(());
    };
    ctx.config.roles = read_live_roles(path)?;
    ctx.worker = current_worker(&ctx.config, &ctx.worker.id)?;
    Ok(())
}

pub(crate) fn live_config(ctx: &WorkerContext) -> Result<(ProjectConfig, WorkerSpec)> {
    let Some(path) = &ctx.config_path else {
        return Ok((ctx.config.clone(), ctx.worker.clone()));
    };
    let mut config = ctx.config.clone();
    config.roles = read_live_roles(path)?;
    let worker = current_worker(&config, &ctx.worker.id)?;
    Ok((config, worker))
}

fn read_live_roles(path: &std::path::Path) -> Result<Vec<RoleConfig>> {
    #[derive(Deserialize)]
    struct LiveAgentConfig {
        roles: Vec<RoleConfig>,
    }
    let text = fs::read_to_string(path)
        .with_context(|| format!("could not reload live agent config from {}", path.display()))?;
    let live: LiveAgentConfig = serde_json::from_str(&text)
        .with_context(|| format!("could not parse live agent config from {}", path.display()))?;
    let names: HashSet<_> = live.roles.iter().map(|role| role.name.as_str()).collect();
    anyhow::ensure!(
        names.len() == live.roles.len(),
        "live agent config contains duplicate roles"
    );
    Ok(live.roles)
}

fn current_worker(config: &ProjectConfig, worker_id: &str) -> Result<WorkerSpec> {
    config
        .workers()
        .into_iter()
        .find(|worker| worker.id == worker_id)
        .with_context(|| format!("live agent config no longer contains {worker_id}"))
}
