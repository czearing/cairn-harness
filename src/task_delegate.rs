use crate::{store::Store, task_query::keyed_id};
use anyhow::{Result, bail};
use chrono::Utc;

impl Store {
    pub async fn delegate_current(
        &self,
        agent: &str,
        assignee: &str,
        topic: &str,
        body: &str,
    ) -> Result<String> {
        self.delegate_current_compatible(agent, assignee, None, topic, body)
            .await
    }

    pub async fn delegate_current_compatible(
        &self,
        agent: &str,
        requested_assignee: &str,
        capability: Option<&str>,
        topic: &str,
        body: &str,
    ) -> Result<String> {
        let parent = match self.current_assignment(agent).await {
            Ok(parent) => parent,
            Err(error) => {
                if let Ok(parent) = self.active_coordination_assignment(agent).await {
                    parent
                } else {
                    let existing: Option<(String, String)> = sqlx::query_as(
                        "SELECT child.id,child.status FROM tasks child
                     JOIN tasks parent ON parent.id=child.parent_id
                     WHERE child.creator=? AND child.assignee=? AND child.topic=? AND child.body=?
                     AND parent.assignee=? AND parent.status IN ('waiting','pending')
                     ORDER BY child.created_at DESC LIMIT 1",
                    )
                    .bind(agent)
                    .bind(requested_assignee)
                    .bind(topic)
                    .bind(body)
                    .bind(agent)
                    .fetch_optional(&self.pool)
                    .await?;
                    if let Some((id, status)) = existing {
                        if matches!(
                            status.as_str(),
                            "pending" | "claimed" | "waiting" | "deferred" | "buffered" | "backlog"
                        ) {
                            return Ok(id);
                        }

                        bail!(
                            "identical delegation already reached terminal state; use its result"
                        );
                    }

                    return Err(error);
                }
            }
        };
        if parent.kind == "generator" {
            bail!("automatic task generation cannot delegate");
        }
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let capability = capability.map(str::trim).filter(|value| !value.is_empty());
        let target = self
            .resolve_delegation_target(&mut transaction, requested_assignee, capability)
            .await?;
        let assignee = target.agent_id;
        if target.replica_routed
            && let Some((id, existing_body, status, existing_assignee)) =
                sqlx::query_as::<_, (String, String, String, String)>(
                    "SELECT id,body,status,assignee FROM tasks
                     WHERE parent_id=? AND lower(trim(topic))=lower(trim(?))
                     ORDER BY created_at LIMIT 1",
                )
                .bind(&parent.id)
                .bind(topic)
                .fetch_optional(&mut *transaction)
                .await?
        {
            let compatible = if existing_body == body
                && matches!(
                    status.as_str(),
                    "pending" | "claimed" | "waiting" | "deferred" | "buffered" | "backlog"
                ) {
                let (compatible,): (bool,) = sqlx::query_as(
                    "SELECT EXISTS(
                       SELECT 1 FROM agent_replica_profiles profile
                       WHERE profile.agent_id=? AND profile.role_template=?
                       AND profile.replica_eligible=1
                       AND (? IS NULL OR EXISTS(
                         SELECT 1 FROM agent_capabilities capability
                         WHERE capability.agent_id=profile.agent_id
                         AND capability.capability=?
                       ))
                     )",
                )
                .bind(existing_assignee)
                .bind(requested_assignee)
                .bind(capability)
                .bind(capability)
                .fetch_one(&mut *transaction)
                .await?;
                compatible
            } else {
                false
            };
            transaction.rollback().await?;
            if compatible {
                return Ok(id);
            }
            bail!("conflicting delegation already exists for this parent and topic");
        }
        if let Some((id, status)) = sqlx::query_as::<_, (String, String)>(
            "SELECT id,status FROM tasks
             WHERE parent_id=? AND assignee=? AND lower(trim(topic))=lower(trim(?))
             ORDER BY created_at LIMIT 1",
        )
        .bind(&parent.id)
        .bind(&assignee)
        .bind(topic)
        .fetch_optional(&mut *transaction)
        .await?
        {
            if matches!(
                status.as_str(),
                "pending" | "claimed" | "waiting" | "deferred" | "buffered" | "backlog"
            ) {
                transaction.rollback().await?;
                return Ok(id);
            }
            transaction.rollback().await?;
            bail!("equivalent delegation already reached terminal state; use its result");
        }
        let id = keyed_id(&parent.id, &assignee, topic, body);
        if let Some((status,)) =
            sqlx::query_as::<_, (String,)>("SELECT status FROM tasks WHERE id=?")
                .bind(&id)
                .fetch_optional(&mut *transaction)
                .await?
        {
            if matches!(
                status.as_str(),
                "pending" | "claimed" | "waiting" | "deferred" | "buffered" | "backlog"
            ) {
                transaction.rollback().await?;
                return Ok(id);
            }
            transaction.rollback().await?;
            bail!("identical delegation already reached terminal state; use its result");
        }
        // 'waiting' is excluded deliberately: it means the assignee has already delegated its
        // own current work and is otherwise idle, so it must remain eligible to start this new
        // delegation immediately rather than sitting buffered until an unrelated recovery sweep
        // frees it up. See promote_buffered_for_agent for the matching rationale.
        let (busy,): (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE assignee=?
             AND status IN ('pending','claimed','deferred'))
             OR EXISTS(SELECT 1 FROM agents WHERE agent_id=? AND status!='idle')",
        )
        .bind(&assignee)
        .bind(&assignee)
        .fetch_one(&mut *transaction)
        .await?;
        let status = if busy { "buffered" } else { "pending" };
        sqlx::query(
            "INSERT INTO tasks(
             id,parent_id,origin_id,kind,source,creator,assignee,topic,body,status,created_at)
            VALUES(?,?,NULL,'delegation','agent',?,?,?,?,?,?)",
        )
        .bind(&id)
        .bind(&parent.id)
        .bind(agent)
        .bind(&assignee)
        .bind(topic)
        .bind(body)
        .bind(status)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE tasks SET status='waiting',claimed_at=NULL,
             attempts=CASE WHEN status='claimed' AND attempts>0 THEN attempts-1 ELSE attempts END
             WHERE id=? AND assignee=? AND status IN ('claimed','pending','waiting')
             AND claim_generation=?",
        )
        .bind(&parent.id)
        .bind(agent)
        .bind(parent.claim_generation)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(id)
    }
}
