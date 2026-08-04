use super::{
    model::{Event, Finding},
    util,
};

pub fn build(code: &str, scope: &str, events: &[&Event]) -> Finding {
    let latest = events
        .iter()
        .max_by_key(|event| &event.timestamp)
        .expect("finding events");
    let started_at = events
        .iter()
        .map(|event| event.timestamp.as_str())
        .min()
        .unwrap_or(&latest.timestamp)
        .to_owned();
    let severity = if matches!(code, "COMPLIANCE_BLOCK" | "TOOL_CONTRACT") {
        "warning"
    } else if events.iter().any(|event| event.severity == "error") {
        "error"
    } else {
        "warning"
    };
    Finding {
        finding_id: util::short_id(&[code, scope]),
        code: code.into(),
        severity: severity.into(),
        scope: scope.into(),
        summary: summary(code, latest),
        evidence: evidence(latest),
        count: events.len() as i64,
        started_at,
        last_seen_at: latest.timestamp.clone(),
        active: true,
    }
}

fn summary(code: &str, event: &Event) -> String {
    let detail = event.detail.as_deref().unwrap_or("no detail");
    match code {
        "TASK_STUCK" => format!(
            "open {}",
            util::human_duration(event.duration_ms.unwrap_or(0))
        ),
        "OUTPUT_TOKENS_HIGH" => format!("output={} tokens", event.output_tokens.unwrap_or(0)),
        "DATABASE_GROWTH" => format!("db={}MB", event.value.unwrap_or(0.0) as u64 / 1_048_576),
        "TURN_SLOW" | "TOOL_SLOW" => util::human_duration(event.duration_ms.unwrap_or(0)),
        "COMPLIANCE_BLOCK" => "workflow enforcement repeated".into(),
        _ => util::compact(detail, 100),
    }
}

fn evidence(event: &Event) -> String {
    let mut parts = Vec::new();
    if let Some(agent) = &event.agent {
        parts.push(format!("agent={agent}"));
    }
    if let Some(task) = &event.task_id {
        parts.push(format!("task={task}"));
    }
    if let Some(duration) = event.duration_ms {
        parts.push(format!("duration={}", util::human_duration(duration)));
    }
    if let Some(pointer) = &event.pointer {
        parts.push(util::compact(pointer, 100));
    }
    if parts.is_empty() {
        parts.push(format!("at={}", event.timestamp));
    }
    util::compact(&parts.join(" "), 160)
}
