use anyhow::{Context, Result};
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

impl Store {
    pub async fn agent_context(&self, agent_id: &str) -> Result<String> {
        let turns: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT inbound_topic,inbound_body,output_json
             FROM turns
             WHERE agent_id=? AND status IN ('completed','waiting','paused')
             ORDER BY sequence",
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;
        let mut context = String::new();
        for (topic, body, output_json) in turns {
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
