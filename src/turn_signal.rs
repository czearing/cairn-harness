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
use tokio::time::{Duration, Instant, sleep};

/// Shortest gap allowed between two scans of the event file.
///
/// The watcher sends one notification per filesystem write, and an agent streaming a turn
/// appends thousands of times a second, so the notification channel is effectively always
/// ready. Without a floor the wait loop scans as fast as the CPU allows and burns whole cores
/// on a busy agent even though each individual scan is cheap. This is a responsiveness budget,
/// not a throttle on the work: it still notices a change an order of magnitude faster than the
/// 100ms idle fallback, so an operator message is picked up just as promptly.
const MIN_SCAN_INTERVAL: Duration = Duration::from_millis(10);

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
        let mut scan = TurnScan::new(start, &self.running_shells);
        let mut last_scan = Instant::now();
        loop {
            if scan.advance(&self.file, marker)? {
                let events = scan.into_events();
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
            let elapsed = last_scan.elapsed();
            if elapsed < MIN_SCAN_INTERVAL {
                sleep(MIN_SCAN_INTERVAL - elapsed).await;
            }
            // One append can raise several notifications and a streaming turn raises them
            // continuously, so collapse everything queued during the wait into this one scan
            // instead of rescanning once per notification.
            while self.events.try_recv().is_ok() {}
            last_scan = Instant::now();
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

#[cfg(test)]
fn read_events_with_shells(
    file: &PathBuf,
    start: u64,
    marker: Option<&str>,
    initial_running_shells: &HashSet<String>,
) -> Result<Option<TurnEvents>> {
    let mut scan = TurnScan::new(start, initial_running_shells);
    if scan.advance(file, marker)? {
        return Ok(Some(scan.into_events()));
    }
    Ok(None)
}

/// Incremental scan over one agent turn's slice of `events.jsonl`.
///
/// The file is append only, so a wake only has to absorb the bytes written since the previous
/// one. Re-reading and re-parsing from the turn's start offset on every wake made the work
/// quadratic in the size of the turn, which dominates harness CPU on long turns that stream
/// thousands of events.
#[derive(Default)]
struct TurnScan {
    offset: u64,
    pending: Vec<u8>,
    output: Vec<String>,
    tools: Vec<String>,
    tool_calls: HashMap<String, (String, Option<String>)>,
    running_shells: HashSet<String>,
    marker_seen: bool,
    stop: Option<TurnStop>,
}

impl TurnScan {
    fn new(start: u64, running_shells: &HashSet<String>) -> Self {
        Self {
            offset: start,
            running_shells: running_shells.clone(),
            ..Self::default()
        }
    }

    /// Absorbs every newly appended whole line, reporting whether the turn has finished. A
    /// trailing partial line is held back until the writer completes it.
    fn advance(&mut self, file: &PathBuf, marker: Option<&str>) -> Result<bool> {
        let mut source = match File::open(file) {
            Ok(source) => source,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        let mut buffer = std::mem::take(&mut self.pending);
        source.seek(SeekFrom::Start(self.offset))?;
        self.offset += source.read_to_end(&mut buffer)? as u64;
        let mut consumed = 0;
        let mut absorbed = Ok(());
        while let Some(index) = buffer[consumed..].iter().position(|byte| *byte == b'\n') {
            let line = &buffer[consumed..consumed + index];
            consumed += index + 1;
            absorbed = self.absorb(line, marker);
            if absorbed.is_err() {
                break;
            }
        }
        buffer.drain(..consumed);
        self.pending = buffer;
        absorbed?;
        let terminal = marker.is_none() && self.stop.is_some();
        let marked = self.marker_seen && matches!(self.stop, Some(TurnStop::Allowed));
        Ok(terminal || marked)
    }

    fn into_events(self) -> TurnEvents {
        TurnEvents {
            text: self.output.join("\n"),
            tools: self.tools,
            stop: self.stop.unwrap_or_default(),
            running_shells: self.running_shells,
        }
    }

    fn absorb(&mut self, line: &[u8], marker: Option<&str>) -> Result<()> {
        let Ok(text) = std::str::from_utf8(line) else {
            return Ok(());
        };
        let Ok(event) = serde_json::from_str::<Value>(text) else {
            return Ok(());
        };
        match event["type"].as_str() {
            Some("assistant.message") => {
                if let Some(content) = event["data"]["content"].as_str() {
                    self.marker_seen |= marker.is_some_and(|marker| content.contains(marker));
                    if !content.contains("HARNESS_SESSION_READY") {
                        self.output.push(content.to_string());
                    }
                }
            }
            Some("tool.execution_start") => {
                if let Some(name) = event["data"]["toolName"].as_str() {
                    self.tools.push(name.to_string());
                    if let Some(call_id) = event["data"]["toolCallId"].as_str() {
                        self.tool_calls.insert(
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
            Some("tool.execution_complete") => self.absorb_tool_result(&event),
            Some("hook.end") if event["data"]["hookType"] == "agentStop" => {
                self.stop = Some(self.agent_stop(&event));
            }
            Some("hook.end") if event["data"]["hookType"] == "subagentStop" => {
                self.stop = None;
            }
            Some("session.error") => {
                let message = event["data"]["message"]
                    .as_str()
                    .unwrap_or("Copilot session failed");
                anyhow::bail!("Copilot session error: {message}");
            }
            _ => {}
        }
        Ok(())
    }

    fn absorb_tool_result(&mut self, event: &Value) {
        let Some(call_id) = event["data"]["toolCallId"].as_str() else {
            return;
        };
        let Some((name, shell_id)) = self.tool_calls.get(call_id) else {
            return;
        };
        let Some(shell_id) = shell_id.clone() else {
            return;
        };
        let name = tool_name(name).to_string();
        let result = event["data"]["result"].to_string();
        if name == "stop_powershell"
            || (name == "read_powershell" && !result.contains("is still running"))
        {
            self.running_shells.remove(&shell_id);
        } else if name == "powershell" && result.contains("is still running") {
            self.running_shells.insert(shell_id);
        }
    }

    fn agent_stop(&self, event: &Value) -> TurnStop {
        if event["data"]["output"]["decision"] == "block" {
            return TurnStop::Blocked(
                event["data"]["output"]["reason"]
                    .as_str()
                    .filter(|reason| !reason.is_empty())
                    .unwrap_or("Continue and complete every requested task.")
                    .to_string(),
            );
        }
        if self.running_shells.is_empty() {
            return TurnStop::Allowed;
        }
        TurnStop::Blocked(format!(
            "A PowerShell command is still running ({}). Wait for its completion notification, then read it with read_powershell before finishing.",
            self.running_shells
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }
}

fn tool_name(name: &str) -> &str {
    name.rsplit(['.', '/']).next().unwrap_or(name)
}

#[cfg(test)]
#[path = "turn_signal_tests.rs"]
mod tests;
