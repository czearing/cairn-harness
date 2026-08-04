use anyhow::Result;
use chrono::Utc;
use serde_json::Value;
use sqlx::Row;

use crate::{config::ProjectConfig, store::Store};

use super::{model::Event, util};

pub async fn collect(config: &ProjectConfig, store: &Store, cutoff: &str) -> Result<Vec<Event>> {
    let mut events = Vec::new();
    super::collect_tasks::collect(config, store, cutoff, &mut events).await?;
    collect_turns(config, store, cutoff, &mut events).await?;
    super::collect_runtime::collect(config, store, cutoff, &mut events).await?;
    collect_releases(config, store, cutoff, &mut events).await?;
    collect_agents(config, store, &mut events).await?;
    Ok(events)
}

async fn collect_turns(
    config: &ProjectConfig,
    store: &Store,
    cutoff: &str,
    events: &mut Vec<Event>,
) -> Result<()> {
    let rows = sqlx::query(
        "SELECT sequence, message_id, agent_id, session_id, status, started_at,
                completed_at, output_json FROM turns WHERE started_at >= ?",
    )
    .bind(cutoff)
    .fetch_all(&store.pool)
    .await?;
    for row in rows {
        let output: String = row.try_get("output_json")?;
        let parsed: Value = serde_json::from_str(&output).unwrap_or(Value::Null);
        let status: String = row.try_get("status")?;
        let started: String = row.try_get("started_at")?;
        let completed: String = row.try_get("completed_at")?;
        let tools = parsed["tools"].as_array().map_or(0, Vec::len);
        let external_wait = parsed["tools"].as_array().is_some_and(|tools| {
            tools.iter().any(|tool| {
                tool.as_str()
                    .is_some_and(|name| name.contains("discord_wait_for_message"))
            })
        });
        let complete = parsed["complete"].as_bool().unwrap_or(false);
        let detail = format!("complete={complete} tools={tools} external_wait={external_wait}");
        let message_id: String = row.try_get("message_id")?;
        events.push(Event {
            event_key: util::key(&["turn", &message_id, &status, &completed]),
            timestamp: completed.clone(),
            source: "harness_db".into(),
            category: "quality".into(),
            code: format!("turn_{status}"),
            severity: if status == "failed" { "error" } else { "info" }.into(),
            project: config.name.clone(),
            agent: Some(row.try_get("agent_id")?),
            task_id: Some(message_id),
            session_id: Some(row.try_get("session_id")?),
            duration_ms: util::duration_ms(&started, &completed),
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: Some(tools as f64),
            detail: Some(detail),
            pointer: Some(format!("turn:{}", row.try_get::<i64, _>("sequence")?)),
        });
    }
    Ok(())
}

async fn collect_releases(
    config: &ProjectConfig,
    store: &Store,
    cutoff: &str,
    events: &mut Vec<Event>,
) -> Result<()> {
    let rows = sqlx::query(
        "SELECT task_id, attempts, last_error, updated_at
         FROM release_finalizations WHERE updated_at >= ?",
    )
    .bind(cutoff)
    .fetch_all(&store.pool)
    .await?;
    for row in rows {
        let task: String = row.try_get("task_id")?;
        let timestamp: String = row.try_get("updated_at")?;
        events.push(Event {
            event_key: util::key(&["release", &task, &timestamp]),
            timestamp,
            source: "harness_db".into(),
            category: "quality".into(),
            code: "release_unpublished".into(),
            severity: "error".into(),
            project: config.name.clone(),
            agent: None,
            task_id: Some(task),
            session_id: None,
            duration_ms: None,
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: Some(row.try_get::<i64, _>("attempts")? as f64),
            detail: row
                .try_get::<Option<String>, _>("last_error")?
                .map(|value| util::compact(&value, 180)),
            pointer: Some("release_finalizations".into()),
        });
    }

    Ok(())
}

async fn collect_agents(
    config: &ProjectConfig,
    store: &Store,
    events: &mut Vec<Event>,
) -> Result<()> {
    for state in store.states().await? {
        events.push(Event {
            event_key: util::key(&["agent", &state.agent_id, &state.status, &state.updated_at]),
            timestamp: Utc::now().to_rfc3339(),
            source: "harness_db".into(),
            category: "availability".into(),
            code: "agent_state".into(),
            severity: if state.status == "failed" {
                "error"
            } else {
                "info"
            }
            .into(),
            project: config.name.clone(),
            agent: Some(state.agent_id),
            task_id: None,
            session_id: Some(state.session_id),
            duration_ms: util::age_ms(&state.updated_at),
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: None,
            detail: Some(state.status),
            pointer: None,
        });
    }
    Ok(())
}
