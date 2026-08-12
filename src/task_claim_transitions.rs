use crate::{models::Assignment, store::Store, task_claim::ClaimMutation};
use anyhow::Result;

impl Store {
    pub async fn promote_buffered_for_agent(&self, agent: &str) -> Result<bool> {
        // 'waiting' deliberately does not count as busy here: it means the agent has
        // already delegated its current work and is idle except for that delegation, so it
        // must remain free to pick up other buffered work. Two agents that delegate to each
        // other (a->b and b->a) both land in 'waiting' at the same time; if 'waiting' blocked
        // promotion, neither buffered child could ever become claimable and the pair would
        // deadlock forever, since nothing would ever complete to retrigger promotion.
        let result = sqlx::query(
            "UPDATE tasks SET status='pending'
             WHERE id=(
               SELECT id FROM tasks WHERE assignee=? AND kind='delegation'
               AND source='agent' AND status='buffered'
               ORDER BY created_at,id LIMIT 1
             )
             AND NOT EXISTS(
               SELECT 1 FROM tasks active WHERE active.assignee=?
               AND active.status IN ('pending','claimed','deferred')
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
