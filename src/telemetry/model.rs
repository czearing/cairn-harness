use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WorkerIdentity {
    pub pid: u32,
    pub started_at: String,
    pub command: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VersionIdentity {
    pub package_version: String,
    pub git_sha: String,
    pub dirty: bool,
    pub display: String,
    pub executable_sha256: String,
    pub worker: Option<WorkerIdentity>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Event {
    pub event_key: String,
    pub timestamp: String,
    pub source: String,
    pub category: String,
    pub code: String,
    pub severity: String,
    pub project: String,
    pub agent: Option<String>,
    pub task_id: Option<String>,
    pub session_id: Option<String>,
    pub duration_ms: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_nano_aiu: Option<i64>,
    pub value: Option<f64>,
    pub detail: Option<String>,
    pub pointer: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Finding {
    pub finding_id: String,
    pub code: String,
    pub severity: String,
    pub scope: String,
    pub summary: String,
    pub evidence: String,
    pub count: i64,
    pub started_at: String,
    pub last_seen_at: String,
    pub active: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct OutcomeMetrics {
    pub successful_pr_reviews: u32,
    pub failed_pr_reviews: u32,
    pub failed_pr_review_attempts: u32,
    pub resolved_livesite_incidents: u32,
    pub failed_livesite_incidents: u32,
    pub daily: Vec<OutcomeDay>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OutcomeDay {
    pub date: String,
    pub successful_pr_reviews: u32,
    pub resolved_livesite_incidents: u32,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ServiceLevels {
    pub pr_reviews: WorkloadSlo,
    pub livesite_incidents: WorkloadSlo,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct WorkloadSlo {
    pub completed: u32,
    pub queue: LatencyStats,
    pub execution: LatencyStats,
    pub total: LatencyStats,
    pub oldest_pending_ms: Option<i64>,
    pub oldest_running_ms: Option<i64>,
    pub compliant: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct LatencyStats {
    pub samples: u32,
    pub p50_ms: Option<i64>,
    pub p95_ms: Option<i64>,
    pub max_ms: Option<i64>,
    pub target_ms: i64,
    pub breaches: u32,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct QualityMetrics {
    pub completed_tasks: u32,
    pub failed_tasks: u32,
    pub first_attempt_completions: u32,
    pub excess_task_attempts: u32,
    pub completed_turns: u32,
    pub failed_turns: u32,
    pub retried_turns: u32,
    pub successful_tool_calls: u32,
    pub failed_tool_calls: u32,
    pub compliance_blocks: u32,
    pub permission_denials: u32,
    pub missing_results: u32,
    pub unpublished_releases: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Report {
    pub generated_at: String,
    pub window_hours: u32,
    pub version: VersionIdentity,
    pub event_count: usize,
    pub quality: QualityMetrics,
    pub outcomes: OutcomeMetrics,
    pub service_levels: ServiceLevels,
    pub findings: Vec<Finding>,
    pub summary: String,
}

#[cfg(test)]
mod tests {
    use super::{Event, OutcomeMetrics, QualityMetrics};

    #[test]
    fn summarizes_terminal_reviewer_and_livesite_outcomes() {
        let events = [
            review_event("task_completed", "42"),
            review_event("task_failed", "43"),
            event_with_task(
                "pr-reviewer",
                "task_completed",
                "dashboard-message-project:pr-monitor:42:1",
            ),
            event_with_task(
                "pr-reviewer",
                "task_failed",
                "dashboard-message-project:pr-monitor:42:2",
            ),
            livesite_event("task_completed_empty"),
            event("livesite-agent", "task_completed"),
            event("livesite-agent", "task_cancelled"),
            event("developer", "task_completed"),
        ];

        let outcomes = OutcomeMetrics::from_events(&events);

        assert_eq!(outcomes.successful_pr_reviews, 1);
        assert_eq!(outcomes.failed_pr_reviews, 1);
        assert_eq!(outcomes.failed_pr_review_attempts, 1);
        assert_eq!(outcomes.resolved_livesite_incidents, 1);
        assert_eq!(outcomes.failed_livesite_incidents, 0);
        assert_eq!(outcomes.daily.len(), 1);
        assert_eq!(outcomes.daily[0].successful_pr_reviews, 1);
        assert_eq!(outcomes.daily[0].resolved_livesite_incidents, 1);
    }

    #[test]
    fn recovered_pr_retries_do_not_count_as_current_failures() {
        let mut failed = event_with_task("pr-reviewer", "task_failed", "failed-attempt");
        failed.timestamp = "2026-07-24T00:00:00Z".into();
        failed.pointer = Some("pr-review:42:commit-a".into());
        let mut duplicate_runtime = failed.clone();
        duplicate_runtime.source = "runtime".into();
        let mut completed = event_with_task("pr-reviewer", "task_completed", "retry-attempt");
        completed.timestamp = "2026-07-24T00:10:00Z".into();
        completed.pointer = Some("pr-review:42:commit-a".into());

        let outcomes = OutcomeMetrics::from_events(&[failed, duplicate_runtime, completed]);

        assert_eq!(outcomes.successful_pr_reviews, 1);
        assert_eq!(outcomes.failed_pr_review_attempts, 1);
        assert_eq!(outcomes.failed_pr_reviews, 0);
    }

    #[test]
    fn summarizes_quality_from_existing_events() {
        let mut first_attempt = event_with_task("developer", "task_completed", "task-1");
        first_attempt.value = Some(1.0);
        let mut retried = event_with_task("developer", "task_completed_empty", "task-2");
        retried.value = Some(3.0);
        let mut failed = event_with_task("developer", "task_failed", "task-3");
        failed.value = Some(2.0);
        let mut turn = event_with_task("developer", "turn_completed", "task-1");
        turn.category = "quality".into();
        let mut failed_turn = event_with_task("developer", "turn_failed", "task-3");
        failed_turn.category = "quality".into();
        let mut retried_turn = event_with_task("developer", "turn_retrying", "task-3");
        retried_turn.category = "quality".into();
        let mut tool_success = event_with_task("developer", "tool_execution", "");
        tool_success.source = "copilot_session".into();
        tool_success.category = "tools".into();
        let mut tool_failure = tool_success.clone();
        tool_failure.severity = "error".into();
        let mut contract = tool_success.clone();
        contract.code = "tool_contract".into();
        contract.severity = "warning".into();
        let mut compliance = tool_success.clone();
        compliance.code = "compliance_block".into();
        let mut denied = tool_success.clone();
        denied.code = "permission_denied".into();
        denied.category = "quality".into();
        let mut release = event_with_task("developer", "release_unpublished", "task-2");
        release.category = "quality".into();

        let quality = QualityMetrics::from_events(&[
            first_attempt,
            retried,
            failed,
            turn,
            failed_turn,
            retried_turn,
            tool_success,
            tool_failure,
            contract,
            compliance,
            denied,
            release,
        ]);

        assert_eq!(quality.completed_tasks, 2);
        assert_eq!(quality.failed_tasks, 1);
        assert_eq!(quality.first_attempt_completions, 1);
        assert_eq!(quality.excess_task_attempts, 3);
        assert_eq!(quality.completed_turns, 1);
        assert_eq!(quality.failed_turns, 1);
        assert_eq!(quality.retried_turns, 1);
        assert_eq!(quality.successful_tool_calls, 1);
        assert_eq!(quality.failed_tool_calls, 3);
        assert_eq!(quality.compliance_blocks, 1);
        assert_eq!(quality.permission_denials, 1);
        assert_eq!(quality.missing_results, 1);
        assert_eq!(quality.unpublished_releases, 1);
    }

    fn event(agent: &str, code: &str) -> Event {
        event_with_task(agent, code, "")
    }

    fn review_event(code: &str, pr_id: &str) -> Event {
        let mut value = event("pr-reviewer", code);
        value.pointer = Some(format!("pr-review:{pr_id}:commit"));
        value
    }

    fn livesite_event(code: &str) -> Event {
        let mut value = event("livesite-agent", code);
        value.pointer = Some("livesite:incident".into());
        value
    }

    fn event_with_task(agent: &str, code: &str, task_id: &str) -> Event {
        Event {
            event_key: format!("{agent}:{code}"),
            timestamp: "2026-07-24T00:00:00Z".into(),
            source: "harness_db".into(),
            category: "lifecycle".into(),
            code: code.into(),
            severity: "info".into(),
            project: "Test".into(),
            agent: Some(agent.into()),
            task_id: (!task_id.is_empty()).then(|| task_id.into()),
            session_id: None,
            duration_ms: None,
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: None,
            detail: None,
            pointer: None,
        }
    }
}
