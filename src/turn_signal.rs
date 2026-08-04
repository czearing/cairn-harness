use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
};

use anyhow::{Context, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::time::{Duration, sleep};

pub struct TurnSignal {
    file: PathBuf,
    events: mpsc::UnboundedReceiver<()>,
    running_shells: HashSet<String>,
    _watcher: RecommendedWatcher,
}

#[derive(Debug)]
pub struct TurnEvents {
    pub text: String,
    pub tools: Vec<String>,
    pub stop: TurnStop,
    running_shells: HashSet<String>,
}

#[derive(Debug, Default)]
pub enum TurnStop {
    #[default]
    Allowed,
    Blocked(String),
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
            running_shells: HashSet::new(),
            _watcher: watcher,
        })
    }

    pub fn position(&self) -> u64 {
        std::fs::metadata(&self.file)
            .map(|item| item.len())
            .unwrap_or(0)
    }

    pub async fn wait_after(&mut self, start: u64, marker: &str) -> Result<TurnEvents> {
        self.wait_for(start, Some(marker)).await
    }

    pub async fn wait_terminal_after(&mut self, start: u64) -> Result<TurnEvents> {
        self.wait_for(start, None).await
    }

    async fn wait_for(&mut self, start: u64, marker: Option<&str>) -> Result<TurnEvents> {
        loop {
            if let Some(events) =
                read_events_with_shells(&self.file, start, marker, &self.running_shells)?
            {
                self.running_shells = events.running_shells.clone();
                return Ok(events);
            }
            tokio::select! {
                event = self.events.recv() => {
                    if event.is_none() {
                        anyhow::bail!("session event watcher stopped");
                    }
                }
                _ = sleep(Duration::from_millis(100)) => {}
            }
        }
    }
}

#[cfg(test)]
fn read_turn(file: &PathBuf, start: u64, marker: &str) -> Result<Option<TurnEvents>> {
    read_events(file, start, Some(marker))
}

#[cfg(test)]
fn read_events(file: &PathBuf, start: u64, marker: Option<&str>) -> Result<Option<TurnEvents>> {
    read_events_with_shells(file, start, marker, &HashSet::new())
}

fn read_events_with_shells(
    file: &PathBuf,
    start: u64,
    marker: Option<&str>,
    initial_running_shells: &HashSet<String>,
) -> Result<Option<TurnEvents>> {
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
    let mut tool_calls = HashMap::new();
    let mut running_shells = initial_running_shells.clone();
    let mut marker_seen = false;
    let mut stop = None;
    for line in text.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match event["type"].as_str() {
            Some("assistant.message") => {
                if let Some(content) = event["data"]["content"].as_str() {
                    marker_seen |= marker.is_some_and(|marker| content.contains(marker));
                    if !content.contains("HARNESS_SESSION_READY") {
                        output.push(content.to_string());
                    }
                }
            }
            Some("tool.execution_start") => {
                if let Some(name) = event["data"]["toolName"].as_str() {
                    tools.push(name.to_string());
                    if let Some(call_id) = event["data"]["toolCallId"].as_str() {
                        tool_calls.insert(
                            call_id.to_string(),
                            (
                                name.to_string(),
                                event["data"]["arguments"]["shellId"]
                                    .as_str()
                                    .map(str::to_string),
                            ),
                        );
                    }
                }
            }
            Some("tool.execution_complete") => {
                let Some(call_id) = event["data"]["toolCallId"].as_str() else {
                    continue;
                };
                let Some((name, shell_id)) = tool_calls.get(call_id) else {
                    continue;
                };
                let Some(shell_id) = shell_id else {
                    continue;
                };
                let result = event["data"]["result"].to_string();
                if tool_name(name) == "stop_powershell"
                    || (tool_name(name) == "read_powershell"
                        && !result.contains("is still running"))
                {
                    running_shells.remove(shell_id);
                } else if tool_name(name) == "powershell" && result.contains("is still running") {
                    running_shells.insert(shell_id.clone());
                }
            }
            Some("hook.end") if event["data"]["hookType"] == "agentStop" => {
                stop = Some(if event["data"]["output"]["decision"] == "block" {
                    TurnStop::Blocked(
                        event["data"]["output"]["reason"]
                            .as_str()
                            .filter(|reason| !reason.is_empty())
                            .unwrap_or("Continue and complete every requested task.")
                            .to_string(),
                    )
                } else if !running_shells.is_empty() {
                    TurnStop::Blocked(format!(
                        "A PowerShell command is still running ({}). Wait for its completion notification, then read it with read_powershell before finishing.",
                        running_shells
                            .iter()
                            .cloned()
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                } else {
                    TurnStop::Allowed
                });
            }

            Some("hook.end") if event["data"]["hookType"] == "subagentStop" => {
                stop = None;
            }
            Some("session.error") => {
                let message = event["data"]["message"]
                    .as_str()
                    .unwrap_or("Copilot session failed");
                anyhow::bail!("Copilot session error: {message}");
            }
            _ => {}
        }
    }
    let terminal = marker.is_none() && stop.is_some();
    let marked = marker_seen && matches!(stop, Some(TurnStop::Allowed));
    Ok((terminal || marked).then(|| TurnEvents {
        text: output.join("\n"),
        tools,
        stop: stop.unwrap_or_default(),
        running_shells,
    }))
}

fn tool_name(name: &str) -> &str {
    name.rsplit(['.', '/']).next().unwrap_or(name)
}

#[cfg(test)]
#[path = "turn_signal_tests.rs"]
mod tests;
