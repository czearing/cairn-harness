use super::{
    model::{Finding, Report, VersionIdentity},
    util,
};

pub fn report(report: &Report) -> String {
    let version = version(&report.version);
    let outcomes = outcomes(report);
    let quality = quality(report);
    if report.findings.is_empty() {
        return format!("{version} | {} | {outcomes} | {quality}", report.summary);
    }
    let mut lines = vec![format!(
        "{version} | {}h | events={} | findings={} | {outcomes} | {quality}",
        report.window_hours,
        report.event_count,
        report.findings.len()
    )];
    lines.push(table_row(
        "LEVEL", "FINDING", "AFFECTED", "N", "MEANING", "ID",
    ));
    lines.push("-".repeat(128));
    lines.extend(report.findings.iter().map(table_finding));
    lines.join("\n")
}

fn outcomes(report: &Report) -> String {
    format!(
        "PR reviews {}/{} | Livesite {}/{}",
        report.outcomes.successful_pr_reviews,
        report.outcomes.successful_pr_reviews + report.outcomes.failed_pr_reviews,
        report.outcomes.resolved_livesite_incidents,
        report.outcomes.resolved_livesite_incidents + report.outcomes.failed_livesite_incidents,
    )
}

fn quality(report: &Report) -> String {
    let quality = &report.quality;
    format!(
        "Quality tasks {}/{} first-pass {}/{} retries={} turns {}/{} tools {}/{} compliance={} missing={} releases={}",
        quality.completed_tasks,
        quality.completed_tasks + quality.failed_tasks,
        quality.first_attempt_completions,
        quality.completed_tasks,
        quality.excess_task_attempts + quality.retried_turns,
        quality.completed_turns,
        quality.completed_turns + quality.failed_turns,
        quality.successful_tool_calls,
        quality.successful_tool_calls + quality.failed_tool_calls,
        quality.compliance_blocks + quality.permission_denials,
        quality.missing_results,
        quality.unpublished_releases,
    )
}

fn table_finding(value: &Finding) -> String {
    table_row(
        severity(&value.severity),
        label(&value.code),
        &affected(&value.scope),
        &value.count.to_string(),
        &util::compact(&value.summary, 48),
        &value.finding_id,
    )
}

fn table_row(
    level: &str,
    finding: &str,
    affected: &str,
    count: &str,
    meaning: &str,
    id: &str,
) -> String {
    format!("{level:<5} | {finding:<18} | {affected:<26} | {count:>3} | {meaning:<48} | {id}")
}

fn label(code: &str) -> &'static str {
    match code {
        "ACP_EXIT" => "ACP exit",
        "COMPLIANCE_BLOCK" => "Compliance block",
        "DATABASE_GROWTH" => "Database growth",
        "OUTPUT_TOKENS_HIGH" => "Output tokens",
        "PERMISSION_DENIED" => "Permission denied",
        "RELEASE_FAILED" => "Release failed",
        "RESULT_MISSING" => "Result missing",
        "RUNTIME_ERROR" => "Runtime error",
        "SESSION_ROTATION" => "Session rotation",
        "TASK_FAILED" => "Task failed",
        "TASK_RETRY" => "Task retry",
        "TASK_STUCK" => "Task stuck",
        "TELEMETRY_PARSE" => "Telemetry parse",
        "TOOL_CONTRACT" => "Tool contract",
        "TOOL_FAILED" => "Tool failed",
        "TOOL_SLOW" => "Tool slow",
        "TURN_FAILED" => "Turn failed",
        "TURN_RETRY" => "Turn retry",
        "TURN_SLOW" => "Turn slow",
        "UI_DOWN" => "UI down",
        "VERSION_DRIFT" => "Version drift",
        "WORKER_UNKNOWN" => "Worker unknown",
        _ => "Finding",
    }
}

fn affected(scope: &str) -> String {
    if scope.len() >= 32 && scope.chars().all(|value| value.is_ascii_hexdigit()) {
        return format!("task:{}", &scope[..8]);
    }
    util::compact(scope, 26)
}

pub fn finding(value: &Finding) -> String {
    format!(
        "{} {}:{} {} x{} | {} | {}",
        severity(&value.severity),
        value.code,
        value.finding_id,
        value.scope,
        value.count,
        value.summary,
        value.evidence
    )
}

pub fn inspect(value: &Finding) -> String {
    format!(
        "{}\nfirst={} last={} active={}",
        finding(value),
        value.started_at,
        value.last_seen_at,
        value.active
    )
}

fn version(value: &VersionIdentity) -> String {
    let worker = value
        .worker
        .as_ref()
        .map(|worker| format!(" pid={} started={}", worker.pid, worker.started_at))
        .unwrap_or_default();
    format!(
        "V {} exe={}{}",
        value.display,
        &value.executable_sha256[..12.min(value.executable_sha256.len())],
        worker
    )
}

fn severity(value: &str) -> &'static str {
    match value {
        "error" => "E",
        "warning" => "W",
        _ => "I",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finding_output_is_compact() {
        let value = Finding {
            finding_id: "1234abcd".into(),
            code: "TASK_FAILED".into(),
            severity: "error".into(),
            scope: "task-1".into(),
            summary: "exit 1".into(),
            evidence: "agent=a task=task-1".into(),
            count: 2,
            started_at: "a".into(),
            last_seen_at: "b".into(),
            active: true,
        };
        let output = finding(&value);
        assert_eq!(
            output,
            "E TASK_FAILED:1234abcd task-1 x2 | exit 1 | agent=a task=task-1"
        );
        assert!(output.len() < 240);
    }

    #[test]
    fn report_renders_fixed_readable_columns() {
        let value = Finding {
            finding_id: "1234abcd".into(),
            code: "TURN_SLOW".into(),
            severity: "warning".into(),
            scope: "a".repeat(64),
            summary: "8m 42s".into(),
            evidence: "hidden path".into(),
            count: 1,
            started_at: "a".into(),
            last_seen_at: "b".into(),
            active: true,
        };
        let report = Report {
            generated_at: "now".into(),
            window_hours: 24,
            version: VersionIdentity {
                package_version: "1".into(),
                git_sha: "abc".into(),
                dirty: false,
                display: "1+abc".into(),
                executable_sha256: "0123456789abcdef".into(),
                worker: None,
            },
            event_count: 20,
            quality: Default::default(),
            outcomes: Default::default(),
            service_levels: Default::default(),
            findings: vec![value],
            summary: "findings=1".into(),
        };
        let output = super::report(&report);
        assert!(output.contains("LEVEL | FINDING"));
        assert!(output.contains("Turn slow"));
        assert!(output.contains("task:aaaaaaaa"));
        assert!(output.contains("Quality tasks 0/0 first-pass 0/0"));
        assert!(!output.contains("hidden path"));
    }

    #[test]
    fn healthy_report_is_exactly_one_line() {
        let report = Report {
            generated_at: "now".into(),
            window_hours: 24,
            version: VersionIdentity {
                package_version: "1".into(),
                git_sha: "abc".into(),
                dirty: false,
                display: "1+abc".into(),
                executable_sha256: "0123456789abcdef".into(),
                worker: None,
            },
            event_count: 20,
            quality: Default::default(),
            outcomes: Default::default(),
            service_levels: Default::default(),
            findings: Vec::new(),
            summary: "OK 24h events=20".into(),
        };
        assert_eq!(super::report(&report).lines().count(), 1);
    }
}
