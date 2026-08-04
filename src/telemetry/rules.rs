use chrono::{DateTime, Duration, Utc};

use super::model::Event;

pub fn classify(event: &Event) -> Option<(String, String)> {
    let task_scope = event
        .task_id
        .as_ref()
        .or(event.agent.as_ref())
        .cloned()
        .unwrap_or_else(|| event.project.clone());
    let agent_scope = event.agent.clone().unwrap_or_else(|| event.project.clone());
    match event.code.as_str() {
        "task_failed" => Some(("TASK_FAILED".into(), task_scope)),
        "task_retry" if event.value.unwrap_or(0.0) > 1.0 || event.source == "runtime" => {
            Some(("TASK_RETRY".into(), task_scope))
        }
        "task_completed_empty" => Some(("RESULT_MISSING".into(), task_scope)),
        code if code.starts_with("task_")
            && !matches!(code, "task_completed" | "task_cancelled" | "task_pending")
            && event.duration_ms.unwrap_or(0) > 30 * 60 * 1_000 =>
        {
            Some(("TASK_STUCK".into(), task_scope))
        }
        "turn_failed" => Some(("TURN_FAILED".into(), task_scope)),
        "turn_retrying" => Some(("TURN_RETRY".into(), task_scope)),
        code if code.starts_with("turn_")
            && event.duration_ms.unwrap_or(0) > 30 * 60_000
            && !event
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains("external_wait=true")) =>
        {
            Some(("TURN_SLOW".into(), agent_scope))
        }
        "release_unpublished" => Some(("RELEASE_FAILED".into(), task_scope)),
        "tool_execution" if event.severity == "error" => {
            Some(("TOOL_FAILED".into(), tool_scope(event, &agent_scope)))
        }
        "tool_execution" if event.duration_ms.unwrap_or(0) > 40_000 => {
            Some(("TOOL_SLOW".into(), tool_scope(event, &agent_scope)))
        }
        "tool_contract" => Some(("TOOL_CONTRACT".into(), tool_scope(event, &agent_scope))),
        "compliance_block" => Some(("COMPLIANCE_BLOCK".into(), agent_scope)),
        "acp_stopped" if event.severity == "error" => Some(("ACP_EXIT".into(), agent_scope)),
        "permission_denied" => Some(("PERMISSION_DENIED".into(), agent_scope)),
        "telemetry_parse" => Some(("TELEMETRY_PARSE".into(), agent_scope)),
        "ui_health" if event.severity == "error" => Some(("UI_DOWN".into(), agent_scope)),
        "worker_record" if event.severity == "error" => {
            Some(("WORKER_UNKNOWN".into(), agent_scope))
        }
        "version_drift" => Some(("VERSION_DRIFT".into(), agent_scope)),
        "database_size" if event.severity != "info" => {
            Some(("DATABASE_GROWTH".into(), agent_scope))
        }
        "assistant_output" if event.output_tokens.unwrap_or(0) > 32_000 => {
            Some(("OUTPUT_TOKENS_HIGH".into(), agent_scope))
        }
        "session_rotated" => Some(("SESSION_ROTATION".into(), agent_scope)),
        _ if event.severity == "error" && event.source == "runtime" => {
            Some(("RUNTIME_ERROR".into(), agent_scope))
        }
        _ => None,
    }
}

pub fn actionable(code: &str, events: &[&Event], active_since: DateTime<Utc>) -> bool {
    let recent: Vec<_> = events
        .iter()
        .copied()
        .filter(|event| timestamp(event) >= Some(active_since))
        .collect();
    if recent.is_empty() {
        return false;
    }
    match code {
        "COMPLIANCE_BLOCK" => has_current_burst(&recent, 3, Duration::minutes(10)),
        "TOOL_CONTRACT" => has_current_burst(&recent, 2, Duration::minutes(10)),
        "SESSION_ROTATION" => has_current_burst(&recent, 3, Duration::hours(1)),
        "UI_DOWN" | "WORKER_UNKNOWN" => recent
            .iter()
            .filter_map(|event| timestamp(event))
            .any(|time| time >= active_since + Duration::seconds(30)),
        _ => true,
    }
}

fn has_current_burst(events: &[&Event], required: usize, window: Duration) -> bool {
    let mut times: Vec<_> = events.iter().filter_map(|event| timestamp(event)).collect();
    times.sort_unstable();
    let Some(latest) = times.last() else {
        return false;
    };
    *latest >= Utc::now() - window
        && times
            .iter()
            .rev()
            .take_while(|time| *latest - **time <= window)
            .count()
            >= required
}

fn timestamp(event: &Event) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&event.timestamp)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn tool_scope(event: &Event, fallback: &str) -> String {
    let tool = event
        .detail
        .as_deref()
        .and_then(|detail| detail.split(':').next())
        .unwrap_or("unknown");
    format!("{fallback}/{tool}")
}
