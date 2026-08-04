use crate::{models::Assignment, store::Store, task_claim::ClaimMutation};
use anyhow::Result;

impl Store {
    pub async fn promote_buffered_for_agent(&self, agent: &str) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE tasks SET status='pending'
             WHERE id=(
               SELECT id FROM tasks WHERE assignee=? AND kind='delegation'
               AND source='agent' AND status='buffered'
               ORDER BY created_at,id LIMIT 1
             )
             AND NOT EXISTS(
               SELECT 1 FROM tasks active WHERE active.assignee=?
               AND active.status IN ('pending','claimed','waiting','deferred')
             )",
        )
        .bind(agent)
        .bind(agent)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub(crate) async fn defer_unstarted_generation(
        &self,
        task: &Assignment,
    ) -> Result<ClaimMutation> {
        let result = sqlx::query(
            "UPDATE tasks SET status='deferred',claimed_at=NULL,attempts=attempts-1
             WHERE id=? AND assignee=? AND status='claimed' AND claim_generation=? AND attempts>0",
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

    pub async fn defer_unstarted_claim(&self, id: &str) -> Result<bool> {
        let Some(task) = self.assignment_by_id(id).await? else {
            return Ok(false);
        };
        Ok(self.defer_unstarted_generation(&task).await?.applied())
    }

    pub(crate) async fn retry_unstarted_generation(
        &self,
        task: &Assignment,
        error: &str,
    ) -> Result<ClaimMutation> {
        let result = sqlx::query(
            "UPDATE tasks SET status='pending',claimed_at=NULL,attempts=attempts-1,error=?
             WHERE id=? AND assignee=? AND status='claimed' AND claim_generation=? AND attempts>0",
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

    pub async fn retry_unstarted_claim(&self, id: &str, error: &str) -> Result<bool> {
        let Some(task) = self.assignment_by_id(id).await? else {
            return Ok(false);
        };
        Ok(self
            .retry_unstarted_generation(&task, error)
            .await?
            .applied())
    }
}
