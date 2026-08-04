use std::collections::BTreeMap;

use crate::telemetry::model::{Event, OutcomeDay, OutcomeMetrics};

impl OutcomeMetrics {
    pub fn from_events(events: &[Event]) -> Self {
        let mut outcomes = Self::default();
        let mut daily = BTreeMap::<String, OutcomeDay>::new();
        let mut latest_pr_outcomes = BTreeMap::<String, &Event>::new();
        for event in events {
            let completed = event.code == "task_completed" || event.code == "task_completed_empty";
            let failed = event.code == "task_failed";
            if (!completed && !failed) || event.source != "harness_db" {
                continue;
            }
            match event.agent.as_deref() {
                Some("pr-reviewer") if completed && is_pr_review(event) => {
                    outcomes.successful_pr_reviews += 1;
                    day(&mut daily, &event.timestamp).successful_pr_reviews += 1;
                    record_latest_pr_outcome(&mut latest_pr_outcomes, event);
                }
                Some("pr-reviewer") if failed && is_pr_review(event) => {
                    outcomes.failed_pr_review_attempts += 1;
                    record_latest_pr_outcome(&mut latest_pr_outcomes, event);
                }
                Some("livesite-agent") if completed && is_livesite_incident(event) => {
                    outcomes.resolved_livesite_incidents += 1;
                    day(&mut daily, &event.timestamp).resolved_livesite_incidents += 1;
                }
                Some("livesite-agent") if failed && is_livesite_incident(event) => {
                    outcomes.failed_livesite_incidents += 1
                }
                _ => {}
            }
        }
        outcomes.failed_pr_reviews = latest_pr_outcomes
            .values()
            .filter(|event| event.code == "task_failed")
            .count() as u32;
        outcomes.daily = daily.into_values().collect();
        outcomes
    }
}

fn record_latest_pr_outcome<'a>(outcomes: &mut BTreeMap<String, &'a Event>, event: &'a Event) {
    let key = event
        .pointer
        .as_deref()
        .and_then(|pointer| pointer.strip_prefix("pr-review:"))
        .and_then(|value| value.split(':').next())
        .map(|pr_id| format!("pr:{pr_id}"))
        .expect("PR review outcomes require a review cycle pointer");
    if outcomes
        .get(&key)
        .is_none_or(|existing| existing.timestamp <= event.timestamp)
    {
        outcomes.insert(key, event);
    }
}

fn is_pr_review(event: &Event) -> bool {
    event
        .pointer
        .as_deref()
        .is_some_and(|pointer| pointer.starts_with("pr-review:"))
}

fn is_livesite_incident(event: &Event) -> bool {
    event
        .pointer
        .as_deref()
        .is_some_and(|pointer| pointer.starts_with("livesite:"))
}

fn day<'a>(daily: &'a mut BTreeMap<String, OutcomeDay>, timestamp: &str) -> &'a mut OutcomeDay {
    let date = timestamp.get(..10).unwrap_or(timestamp).to_string();
    daily.entry(date.clone()).or_insert(OutcomeDay {
        date,
        successful_pr_reviews: 0,
        resolved_livesite_incidents: 0,
    })
}
