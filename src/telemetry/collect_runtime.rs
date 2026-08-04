use anyhow::Result;
use serde_json::Value;
use sqlx::Row;

use crate::{config::ProjectConfig, store::Store};

use super::{model::Event, util};

pub async fn collect(
    config: &ProjectConfig,
    store: &Store,
    cutoff: &str,
    events: &mut Vec<Event>,
) -> Result<()> {
    let rows = sqlx::query(
        "SELECT sequence, created_at, event_type, severity, agent_id, task_id, session_id,
                detail FROM runtime_events WHERE created_at >= ?",
    )
    .bind(cutoff)
    .fetch_all(&store.pool)
    .await?;
    for row in rows {
        let id: i64 = row.try_get("sequence")?;
        let code: String = row.try_get("event_type")?;
        let detail: String = row.try_get("detail")?;
        events.push(Event {
            event_key: util::key(&["runtime", &id.to_string()]),
            timestamp: row.try_get("created_at")?,
            source: "runtime".into(),
            category: "errors".into(),
            code: code.clone(),
            severity: row.try_get("severity")?,
            project: config.name.clone(),
            agent: row.try_get("agent_id")?,
            task_id: row.try_get("task_id")?,
            session_id: row.try_get("session_id")?,
            duration_ms: None,
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: None,
            detail: Some(runtime_detail(&code, &detail)),
            pointer: Some(format!("runtime:{id}")),
        });
    }
    Ok(())
}

fn runtime_detail(code: &str, detail: &str) -> String {
    if code == "harness_started" {
        return "worker start".into();
    }
    if code == "acp_stopped"
        && let Some(data) = internal_error_data(detail)
    {
        return format!(
            "ACP {} fingerprint={}",
            util::compact(&data, 100),
            util::short_id(&[detail])
        );
    }
    util::compact(detail, 180)
}

fn internal_error_data(detail: &str) -> Option<String> {
    let document = detail.strip_prefix("Internal error:")?.trim();
    let value: Value = serde_json::from_str(document).ok()?;
    value["data"].as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::runtime_detail;

    #[test]
    fn acp_exit_reports_the_structured_process_cause() {
        let detail = r#"Internal error: {
          "spawned_at": "private path",
          "data": "Process exited with exit code: 0xffffffff"
        }"#;
        let output = runtime_detail("acp_stopped", detail);
        assert!(output.contains("Process exited with exit code: 0xffffffff"));
        assert!(output.contains("fingerprint="));
        assert!(!output.contains("private path"));
    }
}
