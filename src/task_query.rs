use anyhow::{Context, Result, bail};

use crate::{
    models::{Assignment, ChildResult},
    store::Store,
    task_query_helpers::{assignment, delegation_label},
};

pub(crate) use crate::task_query_helpers::keyed_id;

type TaskRow = (
    String,
    Option<String>,
    String,
    String,
    String,
    String,
    String,
    String,
    u32,
    i64,
);

impl Store {
    pub async fn current_assignment(&self, agent: &str) -> Result<Assignment> {
        self.claimed_assignment(agent)
            .await?
            .context("agent has no currently claimed task")
    }

    pub(crate) async fn assignment_by_id(&self, id: &str) -> Result<Option<Assignment>> {
        let row: Option<TaskRow> = sqlx::query_as(
            "SELECT id,parent_id,kind,source,creator,assignee,topic,body,attempts,claim_generation
             FROM tasks WHERE id=? AND status='claimed'",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(assignment))
    }

    pub(crate) async fn coordination_assignment(&self, agent: &str) -> Result<Assignment> {
        if let Some(assignment) = self.claimed_assignment(agent).await? {
            return Ok(assignment);
        }
        self.active_coordination_assignment(agent).await
    }

    async fn claimed_assignment(&self, agent: &str) -> Result<Option<Assignment>> {
        let row: Option<TaskRow> = sqlx::query_as(
            "SELECT id,parent_id,kind,source,creator,assignee,topic,body,attempts,claim_generation
             FROM tasks WHERE assignee=? AND status='claimed'
             ORDER BY claimed_at DESC LIMIT 1",
        )
        .bind(agent)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(assignment))
    }

    pub(crate) async fn active_coordination_assignment(&self, agent: &str) -> Result<Assignment> {
        let row: TaskRow = sqlx::query_as(
            "SELECT task.id,task.parent_id,task.kind,task.source,task.creator,
                    task.assignee,task.topic,task.body,task.attempts,task.claim_generation
             FROM tasks task
             JOIN agents agent ON agent.agent_id=task.assignee
             WHERE task.assignee=? AND task.status IN ('waiting','pending')
             AND agent.status='working'
             AND EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=task.id)
             ORDER BY (
               SELECT MAX(child.created_at) FROM tasks child WHERE child.parent_id=task.id
             ) DESC,task.created_at DESC LIMIT 1",
        )
        .bind(agent)
        .fetch_one(&self.pool)
        .await
        .context("agent has no active coordination task")?;
        Ok(assignment(row))
    }

    pub async fn task_status(&self, id: &str) -> Result<String> {
        let (status,): (String,) = sqlx::query_as("SELECT status FROM tasks WHERE id=?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        Ok(status)
    }

    pub async fn task_result(&self, id: &str) -> Result<String> {
        let (result,): (Option<String>,) = sqlx::query_as("SELECT result FROM tasks WHERE id=?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        result.context("completed task has no result")
    }

    pub async fn has_open_children(&self, id: &str) -> Result<bool> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks WHERE parent_id=?
             AND status IN ('pending','claimed','waiting','deferred','buffered','backlog')",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub async fn has_children(&self, id: &str) -> Result<bool> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tasks WHERE parent_id=?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        Ok(count > 0)
    }

    pub async fn delegation_summary(&self, id: &str) -> Result<String> {
        let children: Vec<(String, String)> = sqlx::query_as(
            "SELECT topic,body FROM tasks
             WHERE parent_id=? AND kind='delegation'
             ORDER BY rowid",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        let labels: Vec<_> = children
            .iter()
            .map(|(topic, body)| delegation_label(topic, body))
            .collect();
        Ok(format!(
            "Delegated: {}",
            if labels.is_empty() {
                "delegated task".into()
            } else {
                labels.join("; ")
            }
        ))
    }

    pub async fn generated_task(&self, origin: &str) -> Result<bool> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM tasks WHERE origin_id=? AND kind='root'")
                .bind(origin)
                .fetch_one(&self.pool)
                .await?;
        Ok(count > 0)
    }

    pub async fn terminal_children(&self, id: &str) -> Result<Vec<ChildResult>> {
        let rows: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT assignee,topic,status,coalesce(result,error,'') FROM tasks
             WHERE parent_id=? AND status IN ('completed','failed')
             ORDER BY completed_at",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| ChildResult {
                assignee: row.0,
                topic: row.1,
                status: row.2,
                result: row.3,
            })
            .collect())
    }

    pub(crate) async fn require_agent(&self, agent: &str) -> Result<()> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agents WHERE agent_id=?")
            .bind(agent)
            .fetch_one(&self.pool)
            .await?;
        if count == 0 {
            bail!("unknown agent {agent}");
        }
        Ok(())
    }
}
