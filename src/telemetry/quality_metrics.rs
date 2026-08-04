use crate::telemetry::model::{Event, QualityMetrics};

impl QualityMetrics {
    pub fn from_events(events: &[Event]) -> Self {
        let mut quality = Self::default();
        for event in events {
            match (event.source.as_str(), event.code.as_str()) {
                ("harness_db", "task_completed" | "task_completed_empty") => {
                    quality.completed_tasks += 1;
                    let attempts = event.value.unwrap_or(0.0).max(0.0) as u32;
                    if attempts <= 1 {
                        quality.first_attempt_completions += 1;
                    }
                    quality.excess_task_attempts += attempts.saturating_sub(1);
                    if event.code == "task_completed_empty" {
                        quality.missing_results += 1;
                    }
                }
                ("harness_db", "task_failed") => {
                    quality.failed_tasks += 1;
                    let attempts = event.value.unwrap_or(0.0).max(0.0) as u32;
                    quality.excess_task_attempts += attempts.saturating_sub(1);
                }
                ("harness_db", "turn_completed") => quality.completed_turns += 1,
                ("harness_db", "turn_failed") => quality.failed_turns += 1,
                ("harness_db", "turn_retrying") => quality.retried_turns += 1,
                ("harness_db", "release_unpublished") => quality.unpublished_releases += 1,
                ("copilot_session", "tool_execution" | "expected_tool_duration")
                    if event.severity != "error" =>
                {
                    quality.successful_tool_calls += 1;
                }
                ("copilot_session", "expected_wait_timeout" | "expected_tool_stop") => {
                    quality.successful_tool_calls += 1;
                }
                ("copilot_session", "tool_execution" | "tool_contract")
                    if event.severity == "error" || event.code == "tool_contract" =>
                {
                    quality.failed_tool_calls += 1;
                }
                ("copilot_session", "compliance_block") => {
                    quality.failed_tool_calls += 1;
                    quality.compliance_blocks += 1;
                }
                ("copilot_session", "permission_denied") => quality.permission_denials += 1,
                _ => {}
            }
        }
        quality
    }
}
