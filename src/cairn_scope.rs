use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::Value;

const SERVER_NAME: &str = "cairn";
const REMOTE_URL: &str = "CAIRN_LIBSQL_URL";
const REMOTE_TOKEN: &str = "CAIRN_LIBSQL_TOKEN";

pub fn database(root: &Path) -> PathBuf {
    root.join(".cairn-harness").join("cairn").join("cairn.db")
}

pub fn process_environment(root: &Path) -> [String; 3] {
    [
        format!("CAIRN_DB_PATH={}", database(root).display()),
        format!("{REMOTE_URL}="),
        format!("{REMOTE_TOKEN}="),
    ]
}

pub fn scope_document(document: &mut Value, root: &Path) -> Result<()> {
    let servers = document
        .get_mut("mcpServers")
        .and_then(Value::as_object_mut)
        .context("mcpServers must be an object")?;
    let server = servers
        .get_mut(SERVER_NAME)
        .and_then(Value::as_object_mut)
        .context("required Cairn MCP server is unavailable")?;
    let environment = server
        .entry("env")
        .or_insert_with(|| Value::Object(Default::default()))
        .as_object_mut()
        .context("Cairn MCP environment must be an object")?;
    environment.remove(REMOTE_URL);
    environment.remove(REMOTE_TOKEN);
    environment.insert(
        "CAIRN_DB_PATH".into(),
        Value::String(database(root).display().to_string()),
    );
    Ok(())
}

pub fn scope_profile(file: &Path, root: &Path) -> Result<()> {
    let mut document: Value = serde_json::from_slice(
        &std::fs::read(file)
            .with_context(|| format!("failed to read MCP config {}", file.display()))?,
    )?;
    scope_document(&mut document, root)?;
    std::fs::write(file, serde_json::to_vec_pretty(&document)?)?;
    Ok(())
}

#[cfg(test)]
#[path = "cairn_scope_tests.rs"]
mod tests;
