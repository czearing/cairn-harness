use anyhow::Result;
use sqlx::Row;

use crate::store::Store;

use super::{
    collect_tasks::{is_livesite_incident, pr_review_cycle},
    model::{LatencyStats, ServiceLevels, WorkloadSlo},
    util,
};

const PR_QUEUE_TARGET_MS: i64 = 2 * 60 * 1_000;
const PR_EXECUTION_TARGET_MS: i64 = 15 * 60 * 1_000;
const PR_TOTAL_TARGET_MS: i64 = 15 * 60 * 1_000;
const LIVESITE_QUEUE_TARGET_MS: i64 = 5 * 60 * 1_000;
const LIVESITE_EXECUTION_TARGET_MS: i64 = 30 * 60 * 1_000;
const LIVESITE_TOTAL_TARGET_MS: i64 = 30 * 60 * 1_000;

pub async fn collect(store: &Store, cutoff: &str) -> Result<ServiceLevels> {
    let rows = sqlx::query(
        "WITH first_turns AS (
             SELECT message_id,MIN(started_at) AS first_started_at
             FROM turns GROUP BY message_id
         )
         SELECT tasks.assignee,tasks.body,tasks.status,tasks.created_at,tasks.completed_at,
                first_turns.first_started_at
         FROM tasks
         LEFT JOIN first_turns ON first_turns.message_id=tasks.id
         WHERE tasks.created_at >= ? OR tasks.status NOT IN ('completed','failed','cancelled')",
    )
    .bind(cutoff)
    .fetch_all(&store.pool)
    .await?;
    let mut reviews = Samples::new(
        PR_QUEUE_TARGET_MS,
        PR_EXECUTION_TARGET_MS,
        PR_TOTAL_TARGET_MS,
    );
    let mut livesite = Samples::new(
        LIVESITE_QUEUE_TARGET_MS,
        LIVESITE_EXECUTION_TARGET_MS,
        LIVESITE_TOTAL_TARGET_MS,
    );
    for row in rows {
        let assignee: String = row.try_get("assignee")?;
        let body: String = row.try_get("body")?;
        let samples = if assignee == "pr-reviewer" && pr_review_cycle(&body).is_some() {
            &mut reviews
        } else if assignee == "livesite-agent" && is_livesite_incident(&body) {
            &mut livesite
        } else {
            continue;
        };
        samples.record(
            row.try_get("status")?,
            row.try_get("created_at")?,
            row.try_get("first_started_at")?,
            row.try_get("completed_at")?,
        );
    }
    Ok(ServiceLevels {
        pr_reviews: reviews.finish(),
        livesite_incidents: livesite.finish(),
    })
}

struct Samples {
    queue: Vec<i64>,
    execution: Vec<i64>,
    total: Vec<i64>,
    queue_target: i64,
    execution_target: i64,
    total_target: i64,
    oldest_pending: Option<i64>,
    oldest_running: Option<i64>,
}

impl Samples {
    fn new(queue_target: i64, execution_target: i64, total_target: i64) -> Self {
        Self {
            queue: Vec::new(),
            execution: Vec::new(),
            total: Vec::new(),
            queue_target,
            execution_target,
            total_target,
            oldest_pending: None,
            oldest_running: None,
        }
    }

    fn record(
        &mut self,
        status: String,
        created: String,
        first_started: Option<String>,
        completed: Option<String>,
    ) {
        let age = util::age_ms(&created);
        if status == "pending" {
            self.oldest_pending = maximum(self.oldest_pending, age);
        } else if status == "claimed" {
            self.oldest_running = maximum(self.oldest_running, age);
        }
        if status != "completed" {
            return;
        }
        let Some(completed) = completed else {
            return;
        };
        if let Some(queue) = first_started
            .as_deref()
            .and_then(|value| util::duration_ms(&created, value))
        {
            self.queue.push(queue);
        }
        if let Some(execution) = first_started
            .as_deref()
            .and_then(|value| util::duration_ms(value, &completed))
        {
            self.execution.push(execution);
        }
        if let Some(total) = util::duration_ms(&created, &completed) {
            self.total.push(total);
        }
    }

    fn finish(self) -> WorkloadSlo {
        let queue = stats(self.queue, self.queue_target);
        let execution = stats(self.execution, self.execution_target);
        let total = stats(self.total, self.total_target);
        let compliant = queue.breaches == 0
            && execution.breaches == 0
            && total.breaches == 0
            && self
                .oldest_pending
                .is_none_or(|age| age <= self.queue_target)
            && self
                .oldest_running
                .is_none_or(|age| age <= self.total_target);
        WorkloadSlo {
            completed: total.samples,
            queue,
            execution,
            total,
            oldest_pending_ms: self.oldest_pending,
            oldest_running_ms: self.oldest_running,
            compliant,
        }
    }
}

pub(super) fn stats(mut values: Vec<i64>, target_ms: i64) -> LatencyStats {
    values.sort_unstable();
    LatencyStats {
        samples: values.len() as u32,
        p50_ms: percentile(&values, 50),
        p95_ms: percentile(&values, 95),
        max_ms: values.last().copied(),
        target_ms,
        breaches: values.iter().filter(|value| **value > target_ms).count() as u32,
    }
}

fn percentile(values: &[i64], value: usize) -> Option<i64> {
    if values.is_empty() {
        return None;
    }
    let index = ((values.len() * value).div_ceil(100)).saturating_sub(1);
    values.get(index).copied()
}

fn maximum(left: Option<i64>, right: Option<i64>) -> Option<i64> {
    left.into_iter().chain(right).max()
}
