use anyhow::Result;
use chrono::Utc;

use crate::{models::Assignment, store::Store};

pub(crate) const MAX_DIRECT_CLAIMS_BEFORE_DELEGATION: i64 = 3;

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ClaimMutation {
    Applied,
    Stale,
}

impl ClaimMutation {
    pub(crate) fn applied(self) -> bool {
        self == Self::Applied
    }
}

impl Store {
    pub async fn claim(&self, agent: &str) -> Result<Option<Assignment>> {
        if !self.has_claimable_task(agent).await? {
            return Ok(None);
        }
        let row: Option<TaskRow> = sqlx::query_as(
            "UPDATE tasks SET status='claimed',claimed_at=?,attempts=attempts+1,
             claim_generation=claim_generation+1,error=NULL
             WHERE id=(SELECT id FROM tasks WHERE assignee=? AND status='pending'
             AND EXISTS(SELECT 1 FROM agents WHERE agent_id=? AND status!='paused')
             ORDER BY CASE
               WHEN source='agent' AND (
                 SELECT COALESCE(SUM(newer.attempts),0) FROM tasks newer
                 WHERE newer.assignee=tasks.assignee
                 AND newer.source IN ('message','manual')
                 AND newer.created_at > tasks.created_at
               ) >= ? THEN 0
               WHEN source IN ('message','manual') THEN 1
               WHEN source='agent' THEN 2
               ELSE 3
             END, created_at, id LIMIT 1)
             RETURNING id,parent_id,kind,source,creator,assignee,topic,body,attempts,claim_generation",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(agent)
        .bind(agent)
        .bind(MAX_DIRECT_CLAIMS_BEFORE_DELEGATION)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(assignment))
    }

    async fn has_claimable_task(&self, agent: &str) -> Result<bool> {
        let (claimable,): (bool,) = sqlx::query_as(
            "SELECT EXISTS(
               SELECT 1 FROM tasks
               JOIN agents ON agents.agent_id=tasks.assignee
               WHERE tasks.assignee=? AND tasks.status='pending'
               AND agents.status!='paused'
             )",
        )
        .bind(agent)
        .fetch_one(&self.pool)
        .await?;
        Ok(claimable)
    }

    pub(crate) async fn renew_claim_generation(&self, task: &Assignment) -> Result<ClaimMutation> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let updated = sqlx::query(
            "UPDATE tasks SET claimed_at=?
             WHERE id=? AND assignee=? AND status='claimed' AND claim_generation=?",
        )
        .bind(&now)
        .bind(&task.id)
        .bind(&task.assignee)
        .bind(task.claim_generation)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        if updated == 0 {
            transaction.rollback().await?;
            return Ok(ClaimMutation::Stale);
        }
        sqlx::query("UPDATE agents SET updated_at=? WHERE agent_id=?")
            .bind(now)
            .bind(&task.assignee)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(ClaimMutation::Applied)
    }

    pub async fn renew_claim(&self, id: &str, _agent: &str) -> Result<()> {
        if let Some(task) = self.assignment_by_id(id).await? {
            let _ = self.renew_claim_generation(&task).await?;
        }
        Ok(())
    }

    pub(crate) async fn finish_claim(
        &self,
        task: &Assignment,
        status: &str,
        error: Option<&str>,
    ) -> Result<ClaimMutation> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let updated = sqlx::query(
            "UPDATE tasks SET status=?,error=?,completed_at=?,claimed_at=NULL
             WHERE id=? AND assignee=? AND status='claimed' AND claim_generation=?",
        )
        .bind(status)
        .bind(error)
        .bind(Utc::now().to_rfc3339())
        .bind(&task.id)
        .bind(&task.assignee)
        .bind(task.claim_generation)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        if updated == 0 {
            transaction.rollback().await?;
            return Ok(ClaimMutation::Stale);
        }
        if status == "failed" {
            sqlx::query(
                "UPDATE tasks SET status='pending',claimed_at=NULL
                 WHERE id=(SELECT parent_id FROM tasks WHERE id=?)
                 AND status='waiting'
                 AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=tasks.id
                   AND child.status IN ('pending','claimed','waiting','deferred','buffered','backlog'))",
            )
            .bind(&task.id)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        self.promote_backlog_roots().await?;
        self.promote_buffered_for_agent(&task.assignee).await?;
        Ok(ClaimMutation::Applied)
    }

    pub async fn finish(&self, id: &str, status: &str, error: Option<&str>) -> Result<()> {
        let task = self
            .assignment_by_id(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("task is not currently claimed"))?;
        let _ = self.finish_claim(&task, status, error).await?;
        Ok(())
    }
}

fn assignment(row: TaskRow) -> Assignment {
    Assignment {
        id: row.0,
        parent_id: row.1,
        kind: row.2,
        source: row.3,
        creator: row.4,
        assignee: row.5,
        topic: row.6,
        body: row.7,
        attempts: row.8,
        claim_generation: row.9,
    }
}
