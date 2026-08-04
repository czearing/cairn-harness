use anyhow::Result;
use chrono::Utc;
use sqlx::Row;

use crate::{
    store::Store,
    telemetry::model::{Event, Finding},
};

impl Store {
    pub(crate) async fn record_telemetry_event(&self, event: &Event) -> Result<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO telemetry_events(
             event_key,timestamp,source,category,code,severity,project,agent,task_id,
             session_id,duration_ms,input_tokens,output_tokens,cost_nano_aiu,value,detail,pointer)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(&event.event_key)
        .bind(&event.timestamp)
        .bind(&event.source)
        .bind(&event.category)
        .bind(&event.code)
        .bind(&event.severity)
        .bind(&event.project)
        .bind(&event.agent)
        .bind(&event.task_id)
        .bind(&event.session_id)
        .bind(event.duration_ms)
        .bind(event.input_tokens)
        .bind(event.output_tokens)
        .bind(event.cost_nano_aiu)
        .bind(event.value)
        .bind(&event.detail)
        .bind(&event.pointer)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub(crate) async fn sync_telemetry_findings(&self, findings: &[Finding]) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE telemetry_findings SET active=0,resolved_at=? WHERE active=1")
            .bind(&now)
            .execute(&self.pool)
            .await?;
        for item in findings {
            sqlx::query(
                "INSERT INTO telemetry_findings(
                 finding_id,code,severity,scope,summary,evidence,occurrence_count,
                 started_at,last_seen_at,active,resolved_at)
                 VALUES(?,?,?,?,?,?,?,?,?,1,NULL)
                 ON CONFLICT(finding_id) DO UPDATE SET code=excluded.code,
                 severity=excluded.severity,scope=excluded.scope,summary=excluded.summary,
                 evidence=excluded.evidence,occurrence_count=excluded.occurrence_count,
                 last_seen_at=excluded.last_seen_at,active=1,resolved_at=NULL",
            )
            .bind(&item.finding_id)
            .bind(&item.code)
            .bind(&item.severity)
            .bind(&item.scope)
            .bind(&item.summary)
            .bind(&item.evidence)
            .bind(item.count)
            .bind(&item.started_at)
            .bind(&item.last_seen_at)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub(crate) async fn active_telemetry_findings(&self) -> Result<Vec<Finding>> {
        load(
            &self.pool,
            "SELECT finding_id,code,severity,scope,summary,evidence,occurrence_count,
             started_at,last_seen_at,active FROM telemetry_findings
             WHERE active=1 ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END,last_seen_at DESC",
            None,
        )
        .await
    }

    pub(crate) async fn telemetry_finding(&self, id: &str) -> Result<Option<Finding>> {
        Ok(load(
            &self.pool,
            "SELECT finding_id,code,severity,scope,summary,evidence,occurrence_count,
             started_at,last_seen_at,active FROM telemetry_findings WHERE finding_id=?",
            Some(id),
        )
        .await?
        .into_iter()
        .next())
    }

    pub(crate) async fn prune_telemetry(&self) -> Result<()> {
        sqlx::query("DELETE FROM telemetry_events WHERE timestamp < datetime('now','-30 days')")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "DELETE FROM telemetry_findings
             WHERE active=0 AND last_seen_at < datetime('now','-90 days')",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

async fn load(
    pool: &sqlx::SqlitePool,
    statement: &'static str,
    id: Option<&str>,
) -> Result<Vec<Finding>> {
    let query = sqlx::query(statement);
    let rows = if let Some(id) = id {
        query.bind(id).fetch_all(pool).await?
    } else {
        query.fetch_all(pool).await?
    };
    rows.into_iter()
        .map(|row| {
            Ok(Finding {
                finding_id: row.try_get("finding_id")?,
                code: row.try_get("code")?,
                severity: row.try_get("severity")?,
                scope: row.try_get("scope")?,
                summary: row.try_get("summary")?,
                evidence: row.try_get("evidence")?,
                count: row.try_get("occurrence_count")?,
                started_at: row.try_get("started_at")?,
                last_seen_at: row.try_get("last_seen_at")?,
                active: row.try_get::<i64, _>("active")? != 0,
            })
        })
        .collect()
}
