use anyhow::Result;
use sqlx::Row;

use crate::{config::ProjectConfig, store::Store};

use super::{model::Event, util};

pub async fn collect(
    config: &ProjectConfig,
    store: &Store,
    cutoff: &str,
    events: &mut Vec<Event>,
) -> Result<()> {
    let rows = sqlx::query(
        "SELECT id, parent_id, assignee, topic, body, status, attempts, error, created_at,
                claimed_at, completed_at, result
         FROM tasks WHERE created_at >= ? OR status NOT IN ('completed','failed','cancelled')",
    )
    .bind(cutoff)
    .fetch_all(&store.pool)
    .await?;
    for row in rows {
        let status: String = row.try_get("status")?;
        let created: String = row.try_get("created_at")?;
        let completed: Option<String> = row.try_get("completed_at")?;
        let timestamp = completed.as_deref().unwrap_or(&created).to_string();
        let result: Option<String> = row.try_get("result")?;
        let error: Option<String> = row.try_get("error")?;
        let task_id: String = row.try_get("id")?;
        let topic: String = row.try_get("topic")?;
        let body: String = row.try_get("body")?;
        let parent_id: Option<String> = row.try_get("parent_id")?;
        let duration = completed
            .as_deref()
            .and_then(|end| util::duration_ms(&created, end))
            .or_else(|| util::age_ms(&created));
        let detail = if let Some(error) = error {
            util::compact(&error, 180)
        } else if status == "completed" && result.as_deref().unwrap_or("").trim().is_empty() {
            "completed without result".into()
        } else {
            util::compact(&topic, 120)
        };
        let code = if status == "completed" && detail == "completed without result" {
            "task_completed_empty".into()
        } else {
            format!("task_{status}")
        };
        let pointer = pr_review_cycle(&body)
            .or_else(|| is_livesite_incident(&body).then(|| format!("livesite:{task_id}")))
            .or(parent_id);
        events.push(Event {
            event_key: util::key(&["task", &task_id, &status, &timestamp]),
            timestamp,
            source: "harness_db".into(),
            category: "lifecycle".into(),
            code,
            severity: if status == "failed" { "error" } else { "info" }.into(),
            project: config.name.clone(),
            agent: Some(row.try_get("assignee")?),
            task_id: Some(task_id),
            session_id: None,
            duration_ms: duration,
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: Some(row.try_get::<i64, _>("attempts")? as f64),
            detail: Some(detail),
            pointer,
        });
    }

    Ok(())
}

pub(super) fn pr_review_cycle(body: &str) -> Option<String> {
    let first = body.lines().next()?;
    if let Some(remainder) = first.strip_prefix("Review Azure DevOps pull request #") {
        let pr_id = remainder.split(':').next()?.trim();
        if pr_id.is_empty() || !pr_id.chars().all(|character| character.is_ascii_digit()) {
            return None;
        }
        let commit = source_commit(body)?;
        return Some(format!("pr-review:{pr_id}:{commit}"));
    }
    let pr_id = azure_pr_url_id(body)?;
    let commit = source_commit(body).unwrap_or("unversioned");
    Some(format!("pr-review:{pr_id}:{commit}"))
}

pub(super) fn is_livesite_incident(body: &str) -> bool {
    body.lines().next().is_some_and(|line| {
        line.starts_with("Livesite incident:") || line.starts_with("Automated livesite alert:")
    })
}

fn source_commit(body: &str) -> Option<&str> {
    body.lines()
        .find_map(|line| line.strip_prefix("Source commit: "))?
        .split_whitespace()
        .next()
}

fn azure_pr_url_id(body: &str) -> Option<&str> {
    const MARKER: &str = "/pullrequest/";
    body.split_whitespace().find_map(|token| {
        let normalized = token.trim_matches(|character: char| {
            matches!(character, '<' | '>' | '(' | ')' | '[' | ']' | ',' | ';')
        });
        let lower = normalized.to_ascii_lowercase();
        let start = lower.find(MARKER)? + MARKER.len();
        let remainder = normalized.get(start..)?;
        let length = remainder.bytes().take_while(u8::is_ascii_digit).count();
        (length > 0).then(|| &remainder[..length])
    })
}

#[cfg(test)]
mod tests {
    use super::{is_livesite_incident, pr_review_cycle};

    #[test]
    fn extracts_versioned_and_direct_pr_review_cycles() {
        assert_eq!(
            pr_review_cycle(
                "Review Azure DevOps pull request #42: Fix\n\nSource commit: commit-a\nRetry of failed Harness task: task:old"
            )
            .as_deref(),
            Some("pr-review:42:commit-a")
        );
        assert_eq!(
            pr_review_cycle(
                "Review this PR https://office.visualstudio.com/OC/_git/office-bohemia/pullrequest/5511308"
            )
            .as_deref(),
            Some("pr-review:5511308:unversioned")
        );
        assert_eq!(
            pr_review_cycle(
                "Review https://dev.azure.com/office/OC/_git/office-bohemia/pullRequest/5511308)."
            )
            .as_deref(),
            Some("pr-review:5511308:unversioned")
        );
        assert_eq!(
            pr_review_cycle("Review Azure DevOps pull request #42: Fix"),
            None
        );
    }

    #[test]
    fn distinguishes_incidents_from_unrelated_livesite_assignments() {
        assert!(is_livesite_incident(
            "Livesite incident: regression\nBuild 42"
        ));
        assert!(is_livesite_incident(
            "Automated livesite alert: flaky.\nBuild 42"
        ));
        assert!(!is_livesite_incident(
            "Inspect the authenticated live source without editing files."
        ));
    }
}
