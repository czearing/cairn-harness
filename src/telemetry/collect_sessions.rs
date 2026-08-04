use std::{fs, path::Path};

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::config::ProjectConfig;

use super::{model::Event, session_events};

pub fn collect(config: &ProjectConfig, cutoff: DateTime<Utc>) -> Result<Vec<Event>> {
    let root = config.root.join(".cairn-harness").join("copilot-home");
    let mut files = Vec::new();
    visit(&root, &mut files)?;
    let mut events = Vec::new();
    for file in files {
        collect_file(config, &file, cutoff, &mut events);
    }
    Ok(events)
}

fn visit(path: &Path, files: &mut Vec<std::path::PathBuf>) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(path)? {
        let path = entry?.path();
        if path.is_dir() {
            visit(&path, files)?;
        } else if path.file_name().and_then(|name| name.to_str()) == Some("events.jsonl") {
            files.push(path);
        }
    }
    Ok(())
}

fn collect_file(
    config: &ProjectConfig,
    path: &Path,
    cutoff: DateTime<Utc>,
    events: &mut Vec<Event>,
) {
    let agent = path
        .ancestors()
        .nth(3)
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .map(str::to_owned);
    let session = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .map(str::to_owned);
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => {
            events.push(session_events::parse_error(
                config,
                agent,
                session,
                path,
                &error.to_string(),
            ));
            return;
        }
    };
    let mut starts = session_events::ToolStarts::new();
    for (line_number, line) in content.lines().enumerate() {
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(error) => {
                events.push(session_events::parse_error(
                    config,
                    agent.clone(),
                    session.clone(),
                    path,
                    &format!("line={} {error}", line_number + 1),
                ));
                continue;
            }
        };
        let timestamp = value["timestamp"].as_str().unwrap_or_default();
        let parsed = match DateTime::parse_from_rfc3339(timestamp) {
            Ok(value) => value.with_timezone(&Utc),
            Err(_) => continue,
        };
        if parsed < cutoff {
            continue;
        }
        if let Some(event) = session_events::project(
            config,
            path,
            line_number + 1,
            agent.clone(),
            session.clone(),
            &value,
            &mut starts,
        ) {
            events.push(event);
        }
    }
}
