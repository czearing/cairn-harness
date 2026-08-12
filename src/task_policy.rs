use anyhow::Result;

use crate::store::Store;

// Assignee matches the leader itself, or any agent replicating the leader's role template, so
// the shared capacity limit stays correct however many replicas the leader currently has (zero
// or more) instead of only counting the literal leader name.
pub(crate) const MANUAL_LEADER_WORK_ITEM_ROOT: &str = "kind='root' AND source='manual'
    AND parent_id IS NULL AND topic='work-item'
    AND assignee IN (
        SELECT (SELECT leader FROM root_task_policy WHERE singleton=1)
        UNION
        SELECT agent_id FROM agent_replica_profiles
        WHERE replica_eligible=1
          AND role_template=(SELECT leader FROM root_task_policy WHERE singleton=1)
    )";

impl Store {
    pub async fn set_max_active_tasks(&self, limit: Option<u64>, leader: &str) -> Result<()> {
        let limit = limit.unwrap_or(0).min(i64::MAX as u64) as i64;
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        sqlx::query("UPDATE root_task_policy SET max_active_tasks=?,leader=? WHERE singleton=1")
            .bind(limit)
            .bind(leader)
            .execute(&mut *transaction)
            .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE tasks SET status='pending' WHERE kind='root' AND source='manual'
             AND parent_id IS NULL AND topic='work-item' AND status='backlog'
             AND NOT ({MANUAL_LEADER_WORK_ITEM_ROOT})"
        )))
        .execute(&mut *transaction)
        .await?;
        if limit == 0 {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE tasks SET status='pending'
                 WHERE {MANUAL_LEADER_WORK_ITEM_ROOT} AND status='backlog'"
            )))
            .execute(&mut *transaction)
            .await?;
        } else {
            let (active,): (i64,) = sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM tasks WHERE {MANUAL_LEADER_WORK_ITEM_ROOT}
                 AND status IN ('pending','claimed','waiting','deferred')"
            )))
            .fetch_one(&mut *transaction)
            .await?;
            let excess = (active - limit).max(0);
            if excess > 0 {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "UPDATE tasks SET status='backlog'
                     WHERE id IN (
                      SELECT id FROM tasks WHERE {MANUAL_LEADER_WORK_ITEM_ROOT}
                      AND status='pending' ORDER BY created_at DESC,id DESC LIMIT ?
                     )"
                )))
                .bind(excess)
                .execute(&mut *transaction)
                .await?;
            }
            promote_backlog_roots(&mut transaction, limit).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn promote_backlog_roots(&self) -> Result<i64> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let (limit,): (i64,) =
            sqlx::query_as("SELECT max_active_tasks FROM root_task_policy WHERE singleton=1")
                .fetch_one(&mut *transaction)
                .await?;
        let promoted = promote_backlog_roots(&mut transaction, limit).await?;
        transaction.commit().await?;
        Ok(promoted)
    }
}

async fn promote_backlog_roots(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    limit: i64,
) -> Result<i64> {
    if limit == 0 {
        return Ok(sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE tasks SET status='pending'
             WHERE {MANUAL_LEADER_WORK_ITEM_ROOT} AND status='backlog'"
        )))
        .execute(&mut **transaction)
        .await?
        .rows_affected() as i64);
    }
    let (active,): (i64,) = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM tasks WHERE {MANUAL_LEADER_WORK_ITEM_ROOT}
         AND status IN ('pending','claimed','waiting','deferred')"
    )))
    .fetch_one(&mut **transaction)
    .await?;
    let available = (limit - active).max(0);
    if available == 0 {
        return Ok(0);
    }
    Ok(sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE tasks SET status='pending'
         WHERE id IN (
           SELECT id FROM tasks WHERE {MANUAL_LEADER_WORK_ITEM_ROOT} AND status='backlog'
           ORDER BY created_at,id LIMIT ?
         )"
    )))
    .bind(available)
    .execute(&mut **transaction)
    .await?
    .rows_affected() as i64)
}
