use anyhow::Result;
use chrono::Utc;

use crate::{models::Assignment, store::Store, task_claim::ClaimMutation};

impl Store {
    pub async fn is_cancelled(&self, id: &str) -> Result<bool> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM tasks WHERE id=? AND status='cancelled'")
                .bind(id)
                .fetch_one(&self.pool)
                .await?;
        Ok(count > 0)
    }

    pub async fn is_current_claim(&self, id: &str, agent: &str) -> Result<bool> {
        let (claimed,): (bool,) = sqlx::query_as(
            "SELECT EXISTS(
               SELECT 1 FROM tasks WHERE id=? AND assignee=? AND status='claimed'
             )",
        )
        .bind(id)
        .bind(agent)
        .fetch_one(&self.pool)
        .await?;
        Ok(claimed)
    }

    pub(crate) async fn claim_is_current(&self, task: &Assignment) -> Result<bool> {
        let (current,): (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM tasks
             WHERE id=? AND assignee=? AND status='claimed' AND claim_generation=?)",
        )
        .bind(&task.id)
        .bind(&task.assignee)
        .bind(task.claim_generation)
        .fetch_one(&self.pool)
        .await?;
        Ok(current)
    }

    pub(crate) async fn generation_is_current(&self, task: &Assignment) -> Result<bool> {
        let (current,): (bool,) =
            sqlx::query_as("SELECT EXISTS(SELECT 1 FROM tasks WHERE id=? AND claim_generation=?)")
                .bind(&task.id)
                .bind(task.claim_generation)
                .fetch_one(&self.pool)
                .await?;
        Ok(current)
    }

    pub(crate) async fn set_working_for_claim(&self, task: &Assignment) -> Result<ClaimMutation> {
        let result = sqlx::query(
            "UPDATE agents SET status='working',current_topic=?,updated_at=?
             WHERE agent_id=? AND EXISTS(
               SELECT 1 FROM tasks WHERE id=? AND assignee=? AND status='claimed'
               AND claim_generation=?
             )",
        )
        .bind(&task.topic)
        .bind(Utc::now().to_rfc3339())
        .bind(&task.assignee)
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

    pub(crate) async fn set_state_after_claim(
        &self,
        task: &Assignment,
        status: &str,
    ) -> Result<ClaimMutation> {
        let result = sqlx::query(
            "UPDATE agents SET status=?,current_topic=NULL,updated_at=?
             WHERE agent_id=?
             AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND claim_generation=?)
             AND NOT EXISTS(SELECT 1 FROM tasks WHERE assignee=? AND status='claimed')",
        )
        .bind(status)
        .bind(Utc::now().to_rfc3339())
        .bind(&task.assignee)
        .bind(&task.id)
        .bind(task.claim_generation)
        .bind(&task.assignee)
        .execute(&self.pool)
        .await?;
        Ok(if result.rows_affected() == 1 {
            ClaimMutation::Applied
        } else {
            ClaimMutation::Stale
        })
    }

    pub async fn set_idle_if_unclaimed(&self, agent: &str) -> Result<()> {
        sqlx::query(
            "UPDATE agents SET status='idle',current_topic=NULL,updated_at=?
             WHERE agent_id=? AND status!='paused'
             AND NOT EXISTS(
               SELECT 1 FROM tasks WHERE assignee=? AND status='claimed'
             )",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(agent)
        .bind(agent)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn is_agent_paused(&self, agent: &str) -> Result<bool> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM agents WHERE agent_id=? AND status='paused'")
                .bind(agent)
                .fetch_one(&self.pool)
                .await?;
        Ok(count > 0)
    }

    pub async fn should_interrupt_for_pause(&self, id: &str, agent: &str) -> Result<bool> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             JOIN agents ON agents.agent_id=tasks.assignee
             WHERE tasks.id=? AND tasks.assignee=?
             AND (
               (
                 agents.status='paused'
                 AND EXISTS(
                   SELECT 1 FROM operator_pauses WHERE operator_pauses.agent_id=agents.agent_id
                 )
               )
               OR (agents.status='idle' AND tasks.status='pending' AND tasks.claimed_at IS NULL)
             )",
        )
        .bind(id)
        .bind(agent)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub async fn should_interrupt_for_context(&self, id: &str, agent: &str) -> Result<bool> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             JOIN agents ON agents.agent_id=tasks.assignee
             WHERE tasks.id=? AND tasks.assignee=?
             AND tasks.status='pending' AND tasks.claimed_at IS NULL
             AND agents.status='working'
             AND EXISTS(SELECT 1 FROM task_context WHERE task_context.task_id=tasks.id)",
        )
        .bind(id)
        .bind(agent)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }
}
