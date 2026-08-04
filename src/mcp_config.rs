use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::{Value, json};

use crate::{cairn_scope, config::CopilotConfig, mcp_path, models::WorkerSpec};

pub fn write(
    root: &Path,
    worker: &WorkerSpec,
    config: &CopilotConfig,
    runtime_id: &str,
) -> Result<PathBuf> {
    let home = mcp_path::profile(root, worker);
    std::fs::create_dir_all(&home)?;
    let file = home.join("harness-mcp.json");
    let document = document(root, worker, config, runtime_id)?;
    std::fs::write(&file, serde_json::to_vec_pretty(&document)?)?;
    Ok(file)
}

fn document(
    root: &Path,
    worker: &WorkerSpec,
    config: &CopilotConfig,
    runtime_id: &str,
) -> Result<Value> {
    let mut document = load_profile(root, worker)?;
    merge_servers(&mut document, load_base(config)?)?;
    cairn_scope::scope_document(&mut document, root)?;
    add_harness_server(&mut document, root, worker, runtime_id)?;
    Ok(document)
}

fn add_harness_server(
    document: &mut Value,
    root: &Path,
    worker: &WorkerSpec,
    runtime_id: &str,
) -> Result<()> {
    let servers = document
        .as_object_mut()
        .context("MCP configuration must be an object")?
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .context("mcpServers must be an object")?;
    let executable = std::env::current_exe()?;
    servers.insert(
        "cairn-harness".into(),
        json!({
            "type": "local",
            "command": executable,
            "args": ["mcp"],
            "env": {
                "CAIRN_HARNESS_DB": root.join(".cairn-harness").join("harness.db"),
                "CAIRN_HARNESS_AGENT": worker.id,
                "CAIRN_HARNESS_LEADER": worker.leader,
                "CAIRN_HARNESS_IDEA_AGENTS": worker.idea_agents.join(","),
                "CAIRN_HARNESS_RUNTIME_ID": runtime_id
            },
            "tools": ["*"]
        }),
    );
    Ok(())
}

fn load_profile(root: &Path, worker: &WorkerSpec) -> Result<Value> {
    let file = mcp_path::profile(root, worker).join("mcp-config.json");
    if !file.exists() {
        return Ok(json!({}));
    }
    Ok(serde_json::from_slice(&std::fs::read(&file)?)?)
}

fn merge_servers(document: &mut Value, additional: Value) -> Result<()> {
    let Some(additional_servers) = additional.get("mcpServers").and_then(Value::as_object) else {
        return Ok(());
    };
    let servers = document
        .as_object_mut()
        .context("MCP configuration must be an object")?
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .context("mcpServers must be an object")?;
    servers.extend(additional_servers.clone());
    Ok(())
}

fn load_base(config: &CopilotConfig) -> Result<Value> {
    let Some(file) = &config.additional_mcp_config else {
        return Ok(json!({}));
    };
    let content = std::fs::read(file)
        .with_context(|| format!("failed to read MCP config {}", file.display()))?;
    Ok(serde_json::from_slice(&content)?)
}

#[cfg(test)]
#[path = "mcp_config_tests.rs"]
mod tests;
