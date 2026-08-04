use std::collections::BTreeMap;

use chrono::{DateTime, Utc};

use super::{
    finding,
    model::{Event, Finding},
    rules,
};

pub fn detect(events: &[Event], active_since: DateTime<Utc>) -> Vec<Finding> {
    let mut groups: BTreeMap<(String, String), Vec<&Event>> = BTreeMap::new();
    for event in events {
        if let Some((code, scope)) = rules::classify(event) {
            groups.entry((code, scope)).or_default().push(event);
        }
    }
    groups
        .into_iter()
        .filter(|((code, _), values)| {
            rules::actionable(code, values, active_since)
                && !resolved_by_success(code, values, events)
        })
        .map(|((code, scope), values)| finding::build(&code, &scope, &values))
        .collect()
}

fn resolved_by_success(code: &str, values: &[&Event], events: &[Event]) -> bool {
    let Some(latest) = values.iter().max_by_key(|event| &event.timestamp) else {
        return false;
    };
    if matches!(
        code,
        "TASK_FAILED" | "TASK_RETRY" | "TURN_FAILED" | "TURN_RETRY" | "SESSION_ROTATION"
    ) || (code == "TOOL_FAILED"
        && latest
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("Denied by preToolUse hook")))
    {
        return events.iter().any(|event| {
            event.timestamp > latest.timestamp
                && event.agent == latest.agent
                && event.code == "task_completed"
        });
    }
    if !matches!(code, "COMPLIANCE_BLOCK" | "TOOL_FAILED" | "TOOL_SLOW") {
        return false;
    }
    let tool = latest
        .detail
        .as_deref()
        .and_then(|detail| detail.split(':').next())
        .unwrap_or("");
    events.iter().any(|event| {
        event.timestamp > latest.timestamp
            && event.agent == latest.agent
            && event.code == "tool_execution"
            && event.severity == "info"
            && event
                .detail
                .as_deref()
                .and_then(|detail| detail.split(':').next())
                == Some(tool)
            && (code != "TOOL_SLOW" || event.duration_ms.unwrap_or(i64::MAX) <= 40_000)
    })
}

pub fn healthy_summary(hours: u32, event_count: usize) -> String {
    format!(
        "OK {hours}h events={event_count} at={}",
        Utc::now().to_rfc3339()
    )
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;

    fn event(code: &str, severity: &str, at: DateTime<Utc>) -> Event {
        Event {
            event_key: format!("{code}-{at}"),
            timestamp: at.to_rfc3339(),
            source: if code == "acp_stopped" {
                "runtime"
            } else {
                "copilot_session"
            }
            .into(),
            category: "errors".into(),
            code: code.into(),
            severity: severity.into(),
            project: "p".into(),
            agent: Some("a".into()),
            task_id: None,
            session_id: Some("s".into()),
            duration_ms: None,
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: None,
            detail: Some("powershell: failure".into()),
            pointer: None,
        }
    }

    #[test]
    fn finding_ids_are_stable() {
        let now = Utc::now();
        let first = detect(
            &[event("acp_stopped", "error", now)],
            now - Duration::minutes(1),
        );
        let second = detect(
            &[event("acp_stopped", "error", now)],
            now - Duration::minutes(1),
        );
        assert_eq!(first[0].finding_id, second[0].finding_id);
        assert_eq!(first[0].code, "ACP_EXIT");
    }

    #[test]
    fn compliance_requires_a_current_burst() {
        let now = Utc::now();
        let isolated: Vec<_> = (0..20)
            .map(|index| {
                event(
                    "compliance_block",
                    "info",
                    now - Duration::minutes(index * 11),
                )
            })
            .collect();
        assert!(detect(&isolated, now - Duration::days(1)).is_empty());
        let burst: Vec<_> = (0..3)
            .map(|index| event("compliance_block", "info", now - Duration::minutes(index)))
            .collect();
        assert_eq!(
            detect(&burst, now - Duration::hours(1))[0].code,
            "COMPLIANCE_BLOCK"
        );
    }

    #[test]
    fn successful_retry_resolves_a_compliance_burst() {
        let now = Utc::now();
        let mut events: Vec<_> = (1..=3)
            .map(|minutes| event("compliance_block", "info", now - Duration::minutes(minutes)))
            .collect();
        for item in &mut events {
            item.detail = Some("discord_send: blocked".into());
        }
        let mut success = event("tool_execution", "info", now);
        success.detail = Some("discord_send".into());
        events.push(success);
        assert!(detect(&events, now - Duration::hours(1)).is_empty());
    }

    #[test]
    fn successful_fast_retry_resolves_slow_tool_calls() {
        let now = Utc::now();
        let mut slow = event("tool_execution", "info", now - Duration::minutes(1));
        slow.detail = Some("cairn-brain_create".into());
        slow.duration_ms = Some(48_000);
        let mut fast = event("tool_execution", "info", now);
        fast.detail = Some("cairn-brain_create".into());
        fast.duration_ms = Some(1_500);
        assert!(detect(&[slow, fast], now - Duration::hours(1)).is_empty());
    }

    #[test]
    fn successful_tool_retry_resolves_a_tool_failure() {
        let now = Utc::now();
        let failed = event("tool_execution", "error", now - Duration::minutes(1));
        let mut success = event("tool_execution", "info", now);
        success.detail = Some("powershell".into());
        assert!(detect(&[failed, success], now - Duration::hours(1)).is_empty());
    }

    #[test]
    fn later_completed_work_resolves_agent_runtime_failures() {
        let now = Utc::now();
        for code in [
            "task_failed",
            "task_retry",
            "turn_failed",
            "turn_retrying",
            "session_rotated",
        ] {
            let mut failure = event(code, "error", now - Duration::minutes(1));
            failure.task_id = Some("failed-task".into());
            if code == "task_retry" {
                failure.source = "runtime".into();
            }
            let success = event("task_completed", "info", now);
            assert!(
                detect(&[failure, success], now - Duration::hours(1)).is_empty(),
                "{code} should resolve after later completed work"
            );
        }
    }

    #[test]
    fn completed_work_resolves_prior_hook_denials() {
        let now = Utc::now();
        let mut denied = event("tool_execution", "error", now - Duration::minutes(1));
        denied.detail = Some("discord_send: Denied by preToolUse hook".into());
        let success = event("task_completed", "info", now);
        assert!(detect(&[denied, success], now - Duration::hours(1)).is_empty());
    }

    #[test]
    fn stale_failures_resolve_at_release_boundary() {
        let now = Utc::now();
        let stale = event("tool_execution", "error", now - Duration::hours(2));
        assert!(detect(&[stale], now - Duration::hours(1)).is_empty());
    }

    #[test]
    fn startup_transients_wait_for_the_runtime_grace_period() {
        let now = Utc::now();
        let started = now - Duration::seconds(10);
        let worker = event("worker_record", "error", now);
        let ui = event("ui_health", "error", now);
        assert!(detect(&[worker, ui], started).is_empty());

        let older_start = now - Duration::minutes(1);
        assert_eq!(
            detect(
                &[
                    event("worker_record", "error", now),
                    event("ui_health", "error", now),
                ],
                older_start,
            )
            .len(),
            2
        );
    }

    #[test]
    fn latency_uses_agent_scope_and_the_forty_second_budget() {
        let now = Utc::now();
        let mut tool = event("tool_execution", "info", now);
        tool.duration_ms = Some(40_001);
        tool.detail = Some("powershell".into());
        let mut turn = event("turn_completed", "info", now);
        turn.duration_ms = Some(1_800_001);
        let findings = detect(&[tool, turn], now - Duration::minutes(1));
        assert!(
            findings
                .iter()
                .any(|item| { item.code == "TOOL_SLOW" && item.scope == "a/powershell" })
        );
        assert!(
            findings
                .iter()
                .any(|item| item.code == "TURN_SLOW" && item.scope == "a")
        );
    }

    #[test]
    fn completed_external_waits_are_not_slow_turns() {
        let now = Utc::now();
        let mut turn = event("turn_completed", "info", now);
        turn.duration_ms = Some(4_800_000);
        turn.detail = Some("complete=true tools=30 external_wait=true".into());
        assert!(detect(&[turn], now - Duration::minutes(1)).is_empty());
    }
}
