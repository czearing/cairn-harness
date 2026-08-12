use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    models::{AgentOutput, Assignment, TranscriptEntry, WorkerSpec},
    store::Store,
};

pub struct TurnRecord<'a> {
    pub task: &'a Assignment,
    pub worker: &'a WorkerSpec,
    pub session_id: &'a str,
    pub prompt: &'a str,
    pub output: &'a AgentOutput,
    pub status: &'a str,
    pub started_at: &'a str,
    pub completed_at: &'a str,
}

/// Cap on how many of an agent's most recent turns get replayed into a fresh session. The
/// `turns` table itself is never trimmed -- this only bounds what gets resent as a prompt, so
/// a long-running agent's context payload cannot grow forever between operator resets.
const MAX_REPLAYED_TURNS: i64 = 20;

impl Store {
    /// The turns an agent replays into a fresh session. A context reset records a watermark
    /// instead of deleting turns, so the operator keeps the readable transcript while the
    /// agent stops carrying anything that happened before the reset. Only the most recent
    /// `MAX_REPLAYED_TURNS` (post-reset) are ever replayed -- full history stays queryable in
    /// `turns` regardless, this just bounds what gets resent to the model on every fresh session.
    pub async fn agent_context(&self, agent_id: &str) -> Result<String> {
        let cleared_at = self.context_cleared_at(agent_id).await?;
        let mut turns: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT inbound_topic,inbound_body,output_json,completed_at
             FROM turns
             WHERE agent_id=? AND status IN ('completed','waiting','paused')
             ORDER BY sequence DESC
             LIMIT ?",
        )
        .bind(agent_id)
        .bind(MAX_REPLAYED_TURNS)
        .fetch_all(&self.pool)
        .await?;
        turns.reverse();
        let mut context = String::new();
        for (topic, body, output_json, completed_at) in turns {
            if let Some(cleared_at) = &cleared_at
                && !completed_after(completed_at.as_deref(), cleared_at)
            {
                continue;
            }
            let output: AgentOutput =
                serde_json::from_str(&output_json).context("invalid stored turn output")?;
            let response = output.deliverable.as_deref().unwrap_or(&output.summary);
            context.push_str("Prior assignment [");
            context.push_str(&topic);
            context.push_str("]:\n");
            context.push_str(&body);
            context.push_str("\nPrior response:\n");
            context.push_str(response);
            context.push_str("\n\n");
        }
        Ok(context)
    }

    /// Records the point after which an agent may replay its own turns.
    pub async fn clear_agent_context(&self, agent_id: &str, cleared_at: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO context_resets(agent_id,cleared_at) VALUES(?,?)
             ON CONFLICT(agent_id) DO UPDATE SET cleared_at=excluded.cleared_at",
        )
        .bind(agent_id)
        .bind(cleared_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn context_cleared_at(&self, agent_id: &str) -> Result<Option<String>> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT cleared_at FROM context_resets WHERE agent_id=?")
                .bind(agent_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|row| row.0))
    }

    pub async fn record_turn(&self, turn: TurnRecord<'_>) -> Result<()> {
        let id = if turn.status == "completed" {
            format!("{}:completed", turn.task.id)
        } else {
            Uuid::new_v4().to_string()
        };
        sqlx::query(
            "INSERT OR IGNORE INTO turns(
             id,message_id,agent_id,session_id,inbound_sender,inbound_topic,
             inbound_body,prompt,output_json,status,started_at,completed_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(id)
        .bind(&turn.task.id)
        .bind(&turn.worker.id)
        .bind(turn.session_id)
        .bind(&turn.task.creator)
        .bind(&turn.task.topic)
        .bind(&turn.task.body)
        .bind(turn.prompt)
        .bind(serde_json::to_string(turn.output)?)
        .bind(turn.status)
        .bind(turn.started_at)
        .bind(turn.completed_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn transcript(&self) -> Result<Vec<TranscriptEntry>> {
        type Row = (
            i64,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT sequence,agent_id,session_id,inbound_sender,inbound_topic,
             inbound_body,prompt,output_json,status,started_at,completed_at
             FROM turns ORDER BY sequence",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(TranscriptEntry {
                    sequence: row.0,
                    agent_id: row.1,
                    session_id: row.2,
                    inbound_creator: row.3,
                    inbound_topic: row.4,
                    inbound_body: row.5,
                    prompt: row.6,
                    output: serde_json::from_str(&row.7).context("invalid stored turn output")?,
                    status: row.8,
                    started_at: row.9,
                    completed_at: row.10,
                })
            })
            .collect()
    }
}

/// Turn and reset timestamps are both written as RFC 3339 but by different processes, so one
/// may end in `Z` and the other in `+00:00`. Comparing the parsed instants avoids the ordering
/// a plain string comparison gets wrong. An unreadable turn timestamp is treated as predating
/// the reset, because leaking cleared context is the failure the operator asked to prevent.
fn completed_after(completed_at: Option<&str>, cleared_at: &str) -> bool {
    let (Some(completed), Some(cleared)) = (
        completed_at.and_then(instant),
        instant(cleared_at),
    ) else {
        return false;
    };
    completed > cleared
}

fn instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Assignment, WorkerSpec};
    use tempfile::tempdir;

    fn worker() -> WorkerSpec {
        WorkerSpec {
            id: "lead".into(),
            role: "lead".into(),
            description: String::new(),
            prompt: String::new(),
            model: String::new(),
            leader: "lead".into(),
            leader_task_limit: 1,
            idea_agents: Vec::new(),
            delegate_agents: Vec::new(),
        }
    }

    fn assignment(id: &str, body: &str) -> Assignment {
        Assignment {
            id: id.into(),
            parent_id: None,
            kind: "message".into(),
            source: "message".into(),
            creator: "dashboard".into(),
            assignee: "lead".into(),
            topic: "topic".into(),
            body: body.into(),
            attempts: 0,
            claim_generation: 0,
        }
    }

    async fn record(store: &Store, id: &str, body: &str, completed_at: &str) {
        let output = AgentOutput {
            summary: format!("response to {body}"),
            deliverable: None,
            tools: Vec::new(),
            complete: true,
        };
        store
            .record_turn(TurnRecord {
                task: &assignment(id, body),
                worker: &worker(),
                session_id: "session",
                prompt: "prompt",
                output: &output,
                status: "completed",
                started_at: completed_at,
                completed_at,
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn clearing_context_stops_replaying_turns_from_before_the_reset() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        store.register(&worker()).await.unwrap();
        record(&store, "old", "before the reset", "2026-08-04T20:14:05.112534300+00:00").await;

        assert!(
            store.agent_context("lead").await.unwrap().contains("before the reset"),
            "a turn recorded before any reset is replayed"
        );

        store
            .clear_agent_context("lead", "2026-08-05T00:00:00.000Z")
            .await
            .unwrap();

        assert_eq!(
            store.agent_context("lead").await.unwrap(),
            "",
            "no turn from before the reset may be replayed"
        );

        record(&store, "new", "after the reset", "2026-08-06T09:00:00+00:00").await;
        let context = store.agent_context("lead").await.unwrap();
        assert!(context.contains("after the reset"));
        assert!(!context.contains("before the reset"));
    }

    #[tokio::test]
    async fn a_later_reset_replaces_the_earlier_watermark() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        store.register(&worker()).await.unwrap();
        store
            .clear_agent_context("lead", "2026-08-05T00:00:00.000Z")
            .await
            .unwrap();
        record(&store, "middle", "kept for now", "2026-08-06T09:00:00+00:00").await;
        assert!(store.agent_context("lead").await.unwrap().contains("kept for now"));

        store
            .clear_agent_context("lead", "2026-08-07T00:00:00.000Z")
            .await
            .unwrap();

        assert_eq!(store.agent_context("lead").await.unwrap(), "");
    }

    #[tokio::test]
    async fn agent_context_replays_only_the_most_recent_turns_not_full_unbounded_history() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        store.register(&worker()).await.unwrap();
        // One more turn than MAX_REPLAYED_TURNS so the oldest is provably dropped from replay
        // while the DB itself keeps every row (full history stays queryable via `transcript`).
        let total = MAX_REPLAYED_TURNS + 1;
        for turn in 0..total {
            let completed_at = format!("2026-08-{:02}T00:00:00+00:00", 1 + turn);
            record(&store, &format!("turn-{turn}"), &format!("body-{turn}"), &completed_at).await;
        }

        let context = store.agent_context("lead").await.unwrap();
        assert!(
            !context.contains("body-0"),
            "the oldest turn beyond the cap must not be replayed"
        );
        assert!(
            context.contains(&format!("body-{}", total - 1)),
            "the newest turn must always be replayed"
        );
        assert_eq!(
            context.matches("Prior assignment").count(),
            MAX_REPLAYED_TURNS as usize,
            "replay is bounded to MAX_REPLAYED_TURNS regardless of total turn count"
        );

        let all_turns = store.transcript().await.unwrap();
        assert_eq!(
            all_turns.len(),
            total as usize,
            "full history is retained in the DB even though replay is capped"
        );
    }

    #[test]
    fn timestamps_compare_across_offset_and_zulu_spellings() {
        assert!(completed_after(
            Some("2026-08-05T00:00:01+00:00"),
            "2026-08-05T00:00:00.000Z"
        ));
        assert!(!completed_after(
            Some("2026-08-04T23:59:59+00:00"),
            "2026-08-05T00:00:00.000Z"
        ));
        assert!(!completed_after(Some("not a timestamp"), "2026-08-05T00:00:00.000Z"));
        assert!(!completed_after(None, "2026-08-05T00:00:00.000Z"));
    }
}
