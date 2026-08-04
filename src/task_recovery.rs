use anyhow::Result;

use crate::{models::Assignment, store::Store, task_claim::ClaimMutation};

impl Store {
    pub(crate) async fn retry_claim(
        &self,
        task: &Assignment,
        error: &str,
    ) -> Result<ClaimMutation> {
        let result = sqlx::query(
            "UPDATE tasks SET status='pending',claimed_at=NULL,error=?
             WHERE id=? AND assignee=? AND status='claimed' AND claim_generation=?",
        )
        .bind(error)
        .bind(&task.id)
        .bind(&task.assignee)
        .bind(task.claim_generation)
        .execute(&self.pool)
        .await?;
        Ok(if result.rows_affected() == 1 {
            ClaimMutation::Applied
        } else {
            ClaimMutation::Stale
        })
    }

    pub async fn retry(&self, id: &str, error: &str) -> Result<()> {
        let task = self
            .assignment_by_id(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("task is not currently claimed"))?;
        let _ = self.retry_claim(&task, error).await?;
        Ok(())
    }

    pub async fn recover(&self, before: &str) -> Result<u64> {
        let result = sqlx::query(
            "UPDATE tasks SET status='pending',claimed_at=NULL,
             claim_generation=claim_generation+1
             WHERE status='claimed' AND claimed_at < ?",
        )
        .bind(before)
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE agents SET status='idle',current_topic=NULL
             WHERE status='working' AND updated_at < ?",
        )
        .bind(before)
        .execute(&self.pool)
        .await?;
        sqlx::query("UPDATE tasks SET status='pending' WHERE status='deferred'")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "UPDATE tasks SET status='pending'
             WHERE kind='delegation' AND source='agent' AND status='backlog'",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE tasks SET status='pending',claimed_at=NULL
             WHERE status='waiting'
             AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=tasks.id
               AND child.status IN ('pending','claimed','waiting','deferred','buffered','backlog'))",
        )
        .execute(&self.pool)
        .await?;
        let buffered: Vec<(String,)> =
            sqlx::query_as("SELECT DISTINCT assignee FROM tasks WHERE status='buffered'")
                .fetch_all(&self.pool)
                .await?;
        for (agent,) in buffered {
            self.promote_buffered_for_agent(&agent).await?;
        }
        Ok(result.rows_affected())
    }

    pub(crate) async fn wait_for_children_claim(&self, task: &Assignment) -> Result<ClaimMutation> {
        let result = sqlx::query(
            "UPDATE tasks SET status='waiting',claimed_at=NULL,
             attempts=CASE WHEN status='claimed' AND attempts>0 THEN attempts-1 ELSE attempts END
             WHERE id=? AND assignee=? AND status IN ('claimed','waiting') AND claim_generation=?",
        )
        .bind(&task.id)
        .bind(&task.assignee)
        .bind(task.claim_generation)
        .execute(&self.pool)
        .await?;
        Ok(if result.rows_affected() == 1 {
            ClaimMutation::Applied
        } else {
            ClaimMutation::Stale
        })
    }

    pub async fn wait_for_children(&self, id: &str) -> Result<()> {
        if let Some(task) = self.assignment_by_id(id).await? {
            let _ = self.wait_for_children_claim(&task).await?;
        }
        Ok(())
    }
}
