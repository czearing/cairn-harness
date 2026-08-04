use crate::{models::Assignment, store::Store, task_queue::ClaimMutation};
use anyhow::{Result, bail};
use chrono::Utc;

impl Store {
    pub async fn create_from_generator(
        &self,
        agent: &str,
        leader: &str,
        topic: &str,
        body: &str,
    ) -> Result<String> {
        let current = self.current_assignment(agent).await?;
        self.require_agent(leader).await?;
        if current.is_dashboard_message() && agent == leader {
            return self
                .create_root(agent, leader, topic, body, "agent", Some(&current.id))
                .await;
        }
        if current.kind != "generator" {
            bail!(
                "task_create requires automatic generation or a direct dashboard request to the leader"
            );
        }
        self.create_automatic_root_once(
            agent,
            leader,
            topic,
            body,
            &current.id,
            current.source == "automatic-buffer",
        )
        .await
    }

    pub async fn complete_current(&self, agent: &str, result: &str) -> Result<String> {
        let task = self.current_assignment(agent).await?;
        match self.complete_claim(&task, result).await? {
            ClaimMutation::Applied => Ok(task.id),
            ClaimMutation::Stale => bail!("stale task claim"),
        }
    }

    pub(crate) async fn complete_claim(
        &self,
        task: &Assignment,
        result: &str,
    ) -> Result<ClaimMutation> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let (open,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks WHERE parent_id=?
             AND status IN ('pending','claimed','waiting','deferred','buffered','backlog')",
        )
        .bind(&task.id)
        .fetch_one(&mut *transaction)
        .await?;
        if open > 0 {
            transaction.rollback().await?;
            bail!("complete delegated children before completing this task");
        }
        let updated = sqlx::query(
            "UPDATE tasks SET status='completed',result=?,completed_at=?,claimed_at=NULL
             WHERE id=? AND assignee=? AND status='claimed' AND claim_generation=?",
        )
        .bind(result.trim())
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
        if self.publication_enabled()
            && task.kind == "root"
            && task.source != "message"
            && !result.trim().is_empty()
        {
            let hash = blake3::hash(result.trim().as_bytes()).to_hex().to_string();
            sqlx::query(
                "INSERT OR IGNORE INTO release_finalizations(
                 task_id,content_hash,next_attempt_at,created_at,updated_at)
                 SELECT ?,?,?,?,?
                 WHERE NOT EXISTS(
                   SELECT 1 FROM published_task_releases WHERE task_id=?
                 )",
            )
            .bind(&task.id)
            .bind(hash)
            .bind(&now)
            .bind(&now)
            .bind(&now)
            .bind(&task.id)
            .execute(&mut *transaction)
            .await?;
        }
        if let Some(parent) = &task.parent_id {
            sqlx::query(
                "UPDATE tasks SET status='pending',claimed_at=NULL
                 WHERE id=? AND status='waiting'
                 AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=tasks.id
                   AND child.status IN ('pending','claimed','waiting','deferred','buffered','backlog'))",
            )
            .bind(parent)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        self.promote_backlog_roots().await?;
        self.promote_buffered_for_agent(&task.assignee).await?;
        Ok(ClaimMutation::Applied)
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::models::WorkerSpec;

    #[tokio::test]
    async fn dashboard_message_can_create_one_durable_root() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        store
            .register(&WorkerSpec {
                id: "lead".into(),
                role: "lead".into(),
                description: "Lead".into(),
                prompt: "Lead.".into(),
                model: "gpt-5.4-mini".into(),
                leader: "lead".into(),
                leader_task_limit: 1,
                idea_agents: Vec::new(),
            })
            .await
            .unwrap();
        store
            .insert_task(
                "chat",
                None,
                None,
                "message",
                "message",
                "dashboard",
                "lead",
                "dashboard-message",
                "Create durable work.",
            )
            .await
            .unwrap();
        store.claim("lead").await.unwrap().unwrap();

        let first = store
            .create_from_generator("lead", "lead", "validation", "Validate.")
            .await
            .unwrap();
        let second = store
            .create_from_generator("lead", "lead", "validation", "Validate.")
            .await
            .unwrap();

        assert_eq!(first, second);
        assert_eq!(store.task_status(&first).await.unwrap(), "pending");
    }

    #[tokio::test]
    async fn leader_delegations_have_no_project_limit() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        for id in ["lead", "one", "two"] {
            store
                .register(&WorkerSpec {
                    id: id.into(),
                    role: id.into(),
                    description: id.into(),
                    prompt: "Work.".into(),
                    model: "gpt-5.4-mini".into(),
                    leader: "lead".into(),
                    leader_task_limit: 1,
                    idea_agents: Vec::new(),
                })
                .await
                .unwrap();
        }
        store
            .create_message("human", "lead", "root", "Lead.")
            .await
            .unwrap();
        store.claim("lead").await.unwrap().unwrap();
        store
            .set_state("lead", "working", Some("root"))
            .await
            .unwrap();

        let first = store
            .delegate_current("lead", "one", "first", "First.")
            .await
            .unwrap();
        let second = store
            .delegate_current("lead", "two", "second", "Second.")
            .await
            .unwrap();
        assert_eq!(store.task_status(&first).await.unwrap(), "pending");
        assert_eq!(store.task_status(&second).await.unwrap(), "pending");
    }

    #[tokio::test]
    async fn successful_delegation_cycles_do_not_consume_failure_attempts() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        for id in ["lead", "worker"] {
            store
                .register(&WorkerSpec {
                    id: id.into(),
                    role: id.into(),
                    description: id.into(),
                    prompt: "Work.".into(),
                    model: "gpt-5.4-mini".into(),
                    leader: "lead".into(),
                    leader_task_limit: 1,
                    idea_agents: Vec::new(),
                })
                .await
                .unwrap();
        }
        let root = store
            .create_message("human", "lead", "root", "Coordinate.")
            .await
            .unwrap();

        for index in 0..12 {
            store.claim("lead").await.unwrap().unwrap();
            store
                .delegate_current(
                    "lead",
                    "worker",
                    &format!("child-{index}"),
                    "Complete this child.",
                )
                .await
                .unwrap();
            store.claim("worker").await.unwrap().unwrap();
            store.complete_current("worker", "Done.").await.unwrap();
        }

        let (status, attempts): (String, u32) =
            sqlx::query_as("SELECT status,attempts FROM tasks WHERE id=?")
                .bind(&root)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(status, "pending");
        assert_eq!(attempts, 0);
        assert_eq!(store.claim("lead").await.unwrap().unwrap().attempts, 1);
    }

    #[tokio::test]
    async fn paused_agents_cannot_receive_delegations() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        for id in ["lead", "worker"] {
            store
                .register(&WorkerSpec {
                    id: id.into(),
                    role: id.into(),
                    description: id.into(),
                    prompt: "Work.".into(),
                    model: "gpt-5.4-mini".into(),
                    leader: "lead".into(),
                    leader_task_limit: 3,
                    idea_agents: Vec::new(),
                })
                .await
                .unwrap();
        }
        store.set_state("worker", "paused", None).await.unwrap();
        store
            .create_message("human", "lead", "root", "Lead.")
            .await
            .unwrap();
        store.claim("lead").await.unwrap().unwrap();

        let error = store
            .delegate_current("lead", "worker", "work", "Implement.")
            .await
            .unwrap_err();

        assert!(error.to_string().contains("worker is paused"));
    }

    #[tokio::test]
    async fn busy_agents_can_receive_queued_delegations() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        for id in ["lead", "worker"] {
            store
                .register(&WorkerSpec {
                    id: id.into(),
                    role: id.into(),
                    description: id.into(),
                    prompt: "Work.".into(),
                    model: "gpt-5.4-mini".into(),
                    leader: "lead".into(),
                    leader_task_limit: 3,
                    idea_agents: Vec::new(),
                })
                .await
                .unwrap();
        }
        store
            .create_message("human", "worker", "existing", "Existing work.")
            .await
            .unwrap();
        store.claim("worker").await.unwrap().unwrap();
        store
            .create_message("human", "lead", "root", "Lead.")
            .await
            .unwrap();
        store.claim("lead").await.unwrap().unwrap();

        let delegated = store
            .delegate_current("lead", "worker", "next", "Queued work.")
            .await
            .unwrap();

        assert_eq!(store.task_status(&delegated).await.unwrap(), "buffered");
    }

    #[tokio::test]
    async fn equivalent_delegations_cannot_repeat_after_child_completion() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        for id in ["lead", "worker"] {
            store
                .register(&WorkerSpec {
                    id: id.into(),
                    role: id.into(),
                    description: id.into(),
                    prompt: "Work.".into(),
                    model: "gpt-5.4-mini".into(),
                    leader: "lead".into(),
                    leader_task_limit: 3,
                    idea_agents: Vec::new(),
                })
                .await
                .unwrap();
        }
        store
            .create_message("human", "lead", "root", "Lead.")
            .await
            .unwrap();
        store.claim("lead").await.unwrap().unwrap();
        store
            .set_state("lead", "working", Some("root"))
            .await
            .unwrap();
        let delegated = store
            .delegate_current("lead", "worker", "Companion", "First wording.")
            .await
            .unwrap();
        let active_duplicate = store
            .delegate_current("lead", "worker", " companion ", "Changed wording.")
            .await
            .unwrap();
        assert_eq!(active_duplicate, delegated);

        store.claim("worker").await.unwrap().unwrap();
        store
            .complete_current("worker", "Completed companion.")
            .await
            .unwrap();
        let error = store
            .delegate_current("lead", "worker", "COMPANION", "Third wording.")
            .await
            .unwrap_err();

        assert!(error.to_string().contains("equivalent delegation"));
    }
}
