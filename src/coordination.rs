use anyhow::Result;
use chrono::Utc;
use serde_json::json;

use crate::{models::Assignment, store::Store, task_query::keyed_id};

impl Store {
    pub async fn runtime_context(&self, task: &Assignment, leader: &str) -> Result<String> {
        let notes: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT creator,topic,body FROM task_context
             WHERE task_id=? ORDER BY created_at",
        )
        .bind(&task.id)
        .fetch_all(&self.pool)
        .await?;
        let notes: Vec<_> = notes
            .into_iter()
            .map(|(creator, topic, body)| json!({ "from": creator, "topic": topic, "body": body }))
            .collect();
        if task.assignee != leader || task.kind != "root" {
            return Ok(if notes.is_empty() {
                String::new()
            } else {
                json!({ "peer_context": notes }).to_string()
            });
        }
        let agents: Vec<(String, String, Option<String>, i64, i64)> = sqlx::query_as(
            "SELECT agent.agent_id,agent.status,agent.current_topic,
               (SELECT COUNT(*) FROM tasks task
                WHERE task.assignee=agent.agent_id AND task.status='pending'),
               (SELECT COUNT(*) FROM tasks task
                WHERE task.assignee=agent.agent_id AND task.status='buffered')
             FROM agents agent ORDER BY agent.agent_id",
        )
        .fetch_all(&self.pool)
        .await?;
        let agents: Vec<_> = agents
            .into_iter()
            .map(|(id, status, topic, pending, buffered)| {
                json!({
                    "id": id,
                    "status": status,
                    "current_topic": topic,
                    "pending": pending,
                    "buffered": buffered
                })
            })
            .collect();
        let roots: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT id,status,body FROM tasks
             WHERE kind='root' AND parent_id IS NULL AND id<>?
             AND status IN ('pending','claimed','waiting','deferred','backlog')
             ORDER BY created_at LIMIT 12",
        )
        .bind(&task.id)
        .fetch_all(&self.pool)
        .await?;
        let roots: Vec<_> = roots
            .into_iter()
            .map(|(id, status, body)| {
                json!({ "id": id, "status": status, "body": truncate(&body, 240) })
            })
            .collect();
        Ok(json!({
            "team": agents,
            "other_active_roots": roots,
            "peer_context": notes
        })
        .to_string())
    }

    pub async fn send_peer_message(
        &self,
        creator: &str,
        assignee: &str,
        topic: &str,
        body: &str,
    ) -> Result<String> {
        self.require_agent(assignee).await?;
        let assignment = self.coordination_assignment(creator).await?;
        let queued_id = keyed_id(&format!("message:{}", assignment.id), assignee, topic, body);
        if sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?)")
            .bind(&queued_id)
            .fetch_one(&self.pool)
            .await?
        {
            return Ok(queued_id);
        }
        let target = self.message_target(&assignment, assignee).await?;
        let Some((task_id, status)) = target else {
            self.insert_task(
                &queued_id,
                None,
                Some(&assignment.id),
                "message",
                "agent",
                creator,
                assignee,
                topic,
                body,
            )
            .await?;
            return Ok(queued_id);
        };
        let id = keyed_id(
            &format!("context:{}:{}", assignment.id, task_id),
            assignee,
            topic,
            body,
        );
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO task_context(id,task_id,creator,topic,body,created_at)
             VALUES(?,?,?,?,?,?)",
        )
        .bind(&id)
        .bind(&task_id)
        .bind(creator)
        .bind(topic)
        .bind(body)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        if inserted == 1 && status == "claimed" {
            let released = sqlx::query(
                "UPDATE tasks SET status='pending',claimed_at=NULL,attempts=attempts-1,
                 claim_generation=claim_generation+1
                 WHERE id=? AND status='claimed' AND attempts>0",
            )
            .bind(&task_id)
            .execute(&mut *transaction)
            .await?
            .rows_affected();
            if released == 1 {
                sqlx::query(
                    "UPDATE agents SET status='idle',current_topic=NULL,updated_at=?
                     WHERE agent_id=? AND status!='paused'
                     AND NOT EXISTS(
                       SELECT 1 FROM tasks WHERE assignee=? AND status='claimed'
                     )",
                )
                .bind(Utc::now().to_rfc3339())
                .bind(assignee)
                .bind(assignee)
                .execute(&mut *transaction)
                .await?;
            }
        }
        transaction.commit().await?;
        Ok(id)
    }

    async fn message_target(
        &self,
        assignment: &Assignment,
        assignee: &str,
    ) -> Result<Option<(String, String)>> {
        let relation: Option<(Option<String>, Option<String>)> =
            sqlx::query_as("SELECT parent_id,origin_id FROM tasks WHERE id=?")
                .bind(&assignment.id)
                .fetch_optional(&self.pool)
                .await?;
        if let Some((parent, origin)) = relation {
            for id in [parent, origin].into_iter().flatten() {
                let target = sqlx::query_as(
                    "SELECT id,status FROM tasks WHERE id=? AND assignee=?
                     AND status IN ('claimed','waiting','pending')",
                )
                .bind(id)
                .bind(assignee)
                .fetch_optional(&self.pool)
                .await?;
                if target.is_some() {
                    return Ok(target);
                }
            }
        }
        Ok(sqlx::query_as(
            "SELECT id,status FROM tasks WHERE assignee=?
             AND status IN ('claimed','waiting','pending')
             ORDER BY CASE status WHEN 'claimed' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
             created_at DESC LIMIT 1",
        )
        .bind(assignee)
        .fetch_optional(&self.pool)
        .await?)
    }
}

fn truncate(value: &str, limit: usize) -> String {
    let mut output: String = value.chars().take(limit).collect();
    if value.chars().count() > limit {
        output.push_str("...");
    }
    output
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use tempfile::tempdir;

    use super::*;
    use crate::models::WorkerSpec;

    #[tokio::test]
    async fn leader_roots_receive_team_and_active_root_context() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        for agent in ["lead", "worker"] {
            store.register(&worker(agent)).await.unwrap();
        }
        let current = store
            .create_root("dashboard", "lead", "work-item", "Current", "manual", None)
            .await
            .unwrap();
        let other = store
            .create_root(
                "dashboard",
                "lead",
                "work-item",
                "Related active work",
                "manual",
                None,
            )
            .await
            .unwrap();
        let assignment = store.claim("lead").await.unwrap().unwrap();
        assert_eq!(assignment.id, current);
        store
            .set_state("worker", "working", Some("implementation"))
            .await
            .unwrap();

        let context: Value =
            serde_json::from_str(&store.runtime_context(&assignment, "lead").await.unwrap())
                .unwrap();

        assert!(context["team"].as_array().unwrap().iter().any(|agent| {
            agent["id"] == "worker"
                && agent["status"] == "working"
                && agent["current_topic"] == "implementation"
        }));
        assert!(
            context["other_active_roots"]
                .as_array()
                .unwrap()
                .iter()
                .any(|task| task["id"] == other && task["body"] == "Related active work")
        );
    }

    #[tokio::test]
    async fn nonleader_work_does_not_receive_global_team_context() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        for agent in ["lead", "worker"] {
            store.register(&worker(agent)).await.unwrap();
        }
        store
            .create_message("human", "worker", "implementation", "Implement")
            .await
            .unwrap();
        let assignment = store.claim("worker").await.unwrap().unwrap();

        assert_eq!(
            store.runtime_context(&assignment, "lead").await.unwrap(),
            ""
        );
    }

    fn worker(id: &str) -> WorkerSpec {
        WorkerSpec {
            id: id.into(),
            role: id.into(),
            description: format!("{id} agent"),
            prompt: "Work.".into(),
            model: "gpt-5.4-mini".into(),
            leader: "lead".into(),
            leader_task_limit: 3,
            idea_agents: Vec::new(),
        }
    }
}
