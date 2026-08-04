use std::{collections::HashMap, path::Path};

use chrono::Utc;
use serde_json::Value;

use crate::config::ProjectConfig;

use super::{model::Event, session_metrics, util};

pub struct ToolStart {
    timestamp: String,
    name: String,
    input_bytes: usize,
    expected_ms: Option<i64>,
}

pub type ToolStarts = HashMap<String, ToolStart>;

pub fn project(
    config: &ProjectConfig,
    path: &Path,
    line: usize,
    agent: Option<String>,
    session: Option<String>,
    value: &Value,
    starts: &mut ToolStarts,
) -> Option<Event> {
    let timestamp = value["timestamp"].as_str().unwrap_or_default();
    let kind = value["type"].as_str().unwrap_or("unknown");
    let data = &value["data"];
    if let Some(event) =
        session_metrics::project(config, path, line, agent.clone(), session.clone(), value)
    {
        return Some(event);
    }
    match kind {
        "tool.execution_start" => {
            let id = data["toolCallId"].as_str().unwrap_or_default().to_owned();
            let name = data["toolName"].as_str().unwrap_or("unknown").to_owned();
            let arguments = &data["arguments"];
            let expected_seconds = arguments["initial_wait"]
                .as_i64()
                .or_else(|| arguments["delay"].as_i64());
            starts.insert(
                id,
                ToolStart {
                    timestamp: timestamp.to_owned(),
                    name,
                    input_bytes: arguments.to_string().len(),
                    expected_ms: expected_seconds.map(|seconds| seconds * 1_000 + 15_000),
                },
            );
            None
        }
        "tool.execution_complete" => Some(tool_event(
            config, path, line, agent, session, timestamp, data, starts,
        )),
        "permission.completed"
            if data["result"]["kind"].as_str().unwrap_or_default() != "approved" =>
        {
            Some(simple(
                config,
                agent,
                session,
                timestamp,
                "permission_denied",
                "warning",
                data["result"]["kind"].as_str().unwrap_or("denied"),
            ))
        }
        _ => None,
    }
}

fn tool_event(
    config: &ProjectConfig,
    path: &Path,
    line: usize,
    agent: Option<String>,
    session: Option<String>,
    timestamp: &str,
    data: &Value,
    starts: &mut ToolStarts,
) -> Event {
    let id = data["toolCallId"].as_str().unwrap_or_default();
    let start = starts.remove(id).unwrap_or_else(|| ToolStart {
        timestamp: timestamp.to_owned(),
        name: "unknown".into(),
        input_bytes: 0,
        expected_ms: None,
    });
    let success = data["success"].as_bool().unwrap_or(false);
    let error = data["error"]["message"]
        .as_str()
        .or_else(|| data["error"].as_str())
        .unwrap_or("unknown error");
    let output_bytes = data["toolTelemetry"]["metrics"]["mcp_result_content_bytes"]
        .as_i64()
        .unwrap_or_else(|| data["result"].to_string().len() as i64);
    let duration_ms = util::duration_ms(&start.timestamp, timestamp);
    let (code, severity) =
        tool_outcome(&start.name, success, error, duration_ms, start.expected_ms);
    Event {
        event_key: util::key(&["tool", id, timestamp]),
        timestamp: timestamp.into(),
        source: "copilot_session".into(),
        category: "tools".into(),
        code: code.into(),
        severity: severity.into(),
        project: config.name.clone(),
        agent,
        task_id: None,
        session_id: session,
        duration_ms,
        input_tokens: Some(util::estimate_tokens(start.input_bytes)),
        output_tokens: Some(util::estimate_tokens(output_bytes.max(0) as usize)),
        cost_nano_aiu: None,
        value: Some(output_bytes as f64),
        detail: Some(if success {
            start.name
        } else {
            format!("{}: {}", start.name, util::compact(error, 140))
        }),
        pointer: Some(format!("{}:{line}", path.display())),
    }
}

fn tool_outcome<'a>(
    name: &str,
    success: bool,
    error: &'a str,
    duration_ms: Option<i64>,
    expected_ms: Option<i64>,
) -> (&'a str, &'static str) {
    if success {
        if duration_ms
            .zip(expected_ms)
            .is_some_and(|(duration, expected)| duration <= expected)
        {
            return ("expected_tool_duration", "info");
        }
        return ("tool_execution", "info");
    }
    let lower = error.to_ascii_lowercase();
    if name.contains("discord_wait_for_message") && lower.contains("timed out") {
        return ("expected_wait_timeout", "info");
    }
    if lower == "cancelled" || (name == "stop_powershell" && lower.contains("could not be stopped"))
    {
        return ("expected_tool_stop", "info");
    }
    if error.contains("Cairn workflow") {
        return ("compliance_block", "info");
    }
    if lower.contains("search paths do not exist")
        || lower.contains("path does not exist")
        || lower.contains("file already exists")
        || lower.contains("refused to follow redirect")
        || lower.contains("webfetchblockedurlerror")
        || lower.contains("resolves to blocked address")
        || lower.contains("skill not found")
        || lower.contains("agent must be")
        || lower.contains("lacks required capability")
        || lower.contains("no eligible replica for template")
        || lower.contains("\"selected\":[]")
        || lower.contains("no thought with id")
    {
        return ("tool_contract", "warning");
    }
    ("tool_execution", "error")
}

pub fn parse_error(
    config: &ProjectConfig,
    agent: Option<String>,
    session: Option<String>,
    path: &Path,
    error: &str,
) -> Event {
    let now = Utc::now().to_rfc3339();
    let mut event = simple(
        config,
        agent,
        session,
        &now,
        "telemetry_parse",
        "error",
        error,
    );
    event.pointer = Some(path.display().to_string());
    event
}

#[cfg(test)]
mod tests {
    use super::tool_outcome;

    #[test]
    fn classifies_expected_and_contract_failures_without_hiding_crashes() {
        let expected = [
            ("read_agent", "Cancelled", "expected_tool_stop"),
            (
                "stop_powershell",
                "process could not be stopped because its process exited",
                "expected_tool_stop",
            ),
            ("rg", "Search paths do not exist: x", "tool_contract"),
            ("view", "Path does not exist", "tool_contract"),
            ("apply_patch", "File already exists: x", "tool_contract"),
            ("web_fetch", "refused to follow redirect", "tool_contract"),
            (
                "web_fetch",
                "WebFetchBlockedUrlError: URL resolves to blocked address",
                "tool_contract",
            ),
            ("cairn-skill_select", r#"{"selected":[]}"#, "tool_contract"),
            (
                "cairn-harness-task_delegate",
                "assignee livesite-agent lacks required capability browser",
                "tool_contract",
            ),
            (
                "cairn-brain_mutate",
                "no thought with id x",
                "tool_contract",
            ),
        ];
        for _ in 0..20 {
            for (tool, error, code) in expected {
                assert_eq!(tool_outcome(tool, false, error, None, None).0, code);
            }
        }
        assert_eq!(
            tool_outcome("powershell", false, "process crashed", None, None),
            ("tool_execution", "error")
        );
    }

    #[test]
    fn declared_long_tool_waits_are_not_slow_findings() {
        assert_eq!(
            tool_outcome("powershell", true, "", Some(114_000), Some(315_000)),
            ("expected_tool_duration", "info")
        );
        assert_eq!(
            tool_outcome("powershell", true, "", Some(114_000), Some(45_000)),
            ("tool_execution", "info")
        );
    }
}

fn simple(
    config: &ProjectConfig,
    agent: Option<String>,
    session: Option<String>,
    timestamp: &str,
    code: &str,
    severity: &str,
    detail: &str,
) -> Event {
    Event {
        event_key: util::key(&[code, timestamp, session.as_deref().unwrap_or("")]),
        timestamp: timestamp.into(),
        source: "copilot_session".into(),
        category: "quality".into(),
        code: code.into(),
        severity: severity.into(),
        project: config.name.clone(),
        agent,
        task_id: None,
        session_id: session,
        duration_ms: None,
        input_tokens: None,
        output_tokens: None,
        cost_nano_aiu: None,
        value: None,
        detail: Some(util::compact(detail, 180)),
        pointer: None,
    }
}
