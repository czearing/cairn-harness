use anyhow::{Context, Result, bail};
use sqlx::{Sqlite, Transaction};

use crate::{config::RoleConfig, store::Store};

pub(crate) struct DelegationTarget {
    pub agent_id: String,
    pub replica_routed: bool,
}

impl Store {
    pub async fn configure_replica_profiles(&self, roles: &[RoleConfig]) -> Result<()> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        sqlx::query("DELETE FROM agent_capabilities")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM agent_replica_profiles")
            .execute(&mut *transaction)
            .await?;
        for role in roles {
            insert_profile(&mut transaction, role).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn configure_replica_profile(&self, role: &RoleConfig) -> Result<()> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        sqlx::query("DELETE FROM agent_capabilities WHERE agent_id=?")
            .bind(&role.name)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM agent_replica_profiles WHERE agent_id=?")
            .bind(&role.name)
            .execute(&mut *transaction)
            .await?;
        insert_profile(&mut transaction, role).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn resolve_delegation_target(
        &self,
        transaction: &mut Transaction<'_, Sqlite>,
        requested: &str,
        capability: Option<&str>,
    ) -> Result<DelegationTarget> {
        let (configured_template,): (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM agent_replica_profiles
             WHERE role_template=? AND replica_eligible=1)",
        )
        .bind(requested)
        .fetch_one(&mut **transaction)
        .await?;
        if !configured_template {
            let exact: Option<(String, String)> =
                sqlx::query_as("SELECT agent_id,status FROM agents WHERE agent_id=?")
                    .bind(requested)
                    .fetch_optional(&mut **transaction)
                    .await?;
            if let Some((agent_id, status)) = exact {
                if status == "paused" {
                    bail!("assignee {agent_id} is paused; delegate to an active peer");
                }
                self.require_capability(transaction, &agent_id, capability)
                    .await?;
                return Ok(DelegationTarget {
                    agent_id,
                    replica_routed: false,
                });
            }
        }

        let capability = capability.map(str::trim).filter(|value| !value.is_empty());
        let candidates: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT profile.agent_id,agent.status,
                (SELECT COUNT(*) FROM tasks active
                 WHERE active.assignee=profile.agent_id
                 AND active.status IN ('pending','claimed','waiting','deferred'))
             FROM agent_replica_profiles profile
             JOIN agents agent ON agent.agent_id=profile.agent_id
             WHERE profile.role_template=? AND profile.replica_eligible=1
             AND agent.status!='paused'
             AND (? IS NULL OR EXISTS(
               SELECT 1 FROM agent_capabilities capability
               WHERE capability.agent_id=profile.agent_id AND capability.capability=?
             ))
             ORDER BY CASE
               WHEN agent.status='idle' AND NOT EXISTS(
                 SELECT 1 FROM tasks active WHERE active.assignee=profile.agent_id
                 AND active.status IN ('pending','claimed','waiting','deferred')
               ) THEN 0 ELSE 1 END,
               (SELECT COUNT(*) FROM tasks active
                WHERE active.assignee=profile.agent_id
                AND active.status IN ('pending','claimed','waiting','deferred','buffered')),
               profile.agent_id",
        )
        .bind(requested)
        .bind(capability)
        .bind(capability)
        .fetch_all(&mut **transaction)
        .await?;
        let (agent_id, _, _) = candidates
            .into_iter()
            .next()
            .with_context(|| compatible_error(requested, capability))?;
        Ok(DelegationTarget {
            agent_id,
            replica_routed: true,
        })
    }

    async fn require_capability(
        &self,
        transaction: &mut Transaction<'_, Sqlite>,
        agent: &str,
        capability: Option<&str>,
    ) -> Result<()> {
        let Some(capability) = capability.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(());
        };
        let (compatible,): (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM agent_capabilities
             WHERE agent_id=? AND capability=?)",
        )
        .bind(agent)
        .bind(capability)
        .fetch_one(&mut **transaction)
        .await?;
        if !compatible {
            bail!("assignee {agent} lacks required capability {capability}");
        }
        Ok(())
    }
}

async fn insert_profile(
    transaction: &mut Transaction<'_, Sqlite>,
    role: &RoleConfig,
) -> Result<()> {
    if let Some(template) = role.source_agent.as_deref().or(role.template.as_deref()) {
        sqlx::query(
            "INSERT INTO agent_replica_profiles(agent_id,role_template,replica_eligible)
             VALUES(?,?,?)",
        )
        .bind(&role.name)
        .bind(template.trim())
        .bind(role.replica_eligible)
        .execute(&mut **transaction)
        .await?;
    }
    for capability in &role.capabilities {
        sqlx::query("INSERT INTO agent_capabilities(agent_id,capability) VALUES(?,?)")
            .bind(&role.name)
            .bind(capability.trim())
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

fn compatible_error(template: &str, capability: Option<&str>) -> String {
    capability.map_or_else(
        || format!("unknown agent or eligible role template: {template}"),
        |capability| {
            format!("no eligible replica for template {template} with capability {capability}")
        },
    )
}

#[cfg(test)]
#[path = "replica_tests.rs"]
mod tests;
