use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
};

use anyhow::{Context, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::Value;
use tokio::sync::mpsc;

pub struct TurnSignal {
    file: PathBuf,
    events: mpsc::UnboundedReceiver<()>,
    _watcher: RecommendedWatcher,
}

pub struct TurnEvents {
    pub text: String,
    pub tools: Vec<String>,
}

impl TurnSignal {
    pub fn new(root: PathBuf, agent: &str, session: &str) -> Result<Self> {
        let file = root
            .join(".cairn-harness")
            .join("copilot-home")
            .join(agent)
            .join("session-state")
            .join(session)
            .join("events.jsonl");
        let directory = file
            .parent()
            .context("session event directory is unavailable")?;
        std::fs::create_dir_all(directory)?;
        let (send, events) = mpsc::unbounded_channel();
        let mut watcher = notify::recommended_watcher(move |_| {
            let _ = send.send(());
        })?;
        watcher.watch(directory, RecursiveMode::NonRecursive)?;
        Ok(Self {
            file,
            events,
            _watcher: watcher,
        })
    }

    pub fn position(&self) -> u64 {
        std::fs::metadata(&self.file)
            .map(|item| item.len())
            .unwrap_or(0)
    }

    pub async fn wait_after(&mut self, start: u64, marker: &str) -> Result<TurnEvents> {
        while self.events.recv().await.is_some() {
            if let Some(events) = read_turn(&self.file, start, marker)? {
                return Ok(events);
            }
        }
        anyhow::bail!("session event watcher stopped")
    }
}

fn read_turn(file: &PathBuf, start: u64, marker: &str) -> Result<Option<TurnEvents>> {
    let mut source = match File::open(file) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    source.seek(SeekFrom::Start(start))?;
    let mut text = String::new();
    source.read_to_string(&mut text)?;
    let mut output = Vec::new();
    let mut tools = Vec::new();
    let mut marker_seen = false;
    let mut allowed_stop = false;
    for line in text.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match event["type"].as_str() {
            Some("assistant.message") => {
                if let Some(content) = event["data"]["content"].as_str() {
                    marker_seen |= content.contains(marker);
                    if !content.contains("HARNESS_SESSION_READY") {
                        output.push(content.to_string());
                    }
                }
            }
            Some("tool.execution_start") => {
                if let Some(name) = event["data"]["toolName"].as_str() {
                    tools.push(name.to_string());
                }
            }
            Some("hook.end") if event["data"]["hookType"] == "agentStop" => {
                allowed_stop = event["data"]["output"]["decision"] != "block";
            }
            _ => {}
        }
    }
    Ok((marker_seen && allowed_stop).then(|| TurnEvents {
        text: output.join("\n"),
        tools,
    }))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use tempfile::NamedTempFile;

    use super::*;

    #[test]
    fn waits_for_marker_and_allowed_agent_stop() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"{{"type":"assistant.message","data":{{"content":"CAIRN_ENVELOPE_END"}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"block"}}}}}}"#
        )
        .unwrap();

        let path = file.path().to_path_buf();
        assert!(read_turn(&path, 0, "CAIRN_ENVELOPE_END").unwrap().is_none());

        writeln!(
            file,
            r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
        )
        .unwrap();
        file.flush().unwrap();

        let events = read_turn(&path, 0, "CAIRN_ENVELOPE_END").unwrap().unwrap();
        assert_eq!(events.text, "CAIRN_ENVELOPE_END");
    }

    #[test]
    fn ignores_allowed_stop_without_requested_marker() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
        )
        .unwrap();
        file.flush().unwrap();

        assert!(
            read_turn(&file.path().to_path_buf(), 0, "HARNESS_SESSION_READY")
                .unwrap()
                .is_none()
        );
    }
}
