use std::fs;

use anyhow::Result;
use chrono::Utc;

use crate::config::ProjectConfig;

use super::{model::Event, util};

pub async fn collect(config: &ProjectConfig) -> Result<Vec<Event>> {
    let mut events = Vec::new();
    let now = Utc::now().to_rfc3339();
    let health = health_status().await;
    let (severity, detail) = match health {
        Ok(status) if status.starts_with("HTTP/1.1 2") || status.starts_with("HTTP/1.0 2") => {
            ("info", status)
        }
        Ok(status) => ("error", status),
        Err(error) => ("error", util::compact(&error.to_string(), 120)),
    };
    events.push(system_event(
        config,
        &now,
        "ui_health",
        severity,
        &detail,
        None,
    ));

    let worker = fs::read_to_string(config.root.join(".cairn-harness").join("ui-worker.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    let worker_detail = worker.as_ref().map_or_else(
        || {
            if config.paused {
                "project paused".into()
            } else {
                "worker record missing".into()
            }
        },
        |value| {
            let command = value["process"]["command"].as_str().unwrap_or("");
            let mode = if command.contains(" watch") {
                "watch"
            } else if command.contains(" run") {
                "run"
            } else {
                "worker"
            };
            format!(
                "pid={} started={} mode={}",
                value["pid"].as_u64().unwrap_or(0),
                value["startedAt"].as_str().unwrap_or("unknown"),
                mode
            )
        },
    );
    events.push(system_event(
        config,
        &now,
        "worker_record",
        worker_severity(worker.is_some(), config.paused),
        &worker_detail,
        worker.as_ref().and_then(|value| value["pid"].as_f64()),
    ));

    let database_bytes = fs::metadata(config.database_path())
        .map(|value| value.len())
        .unwrap_or(0);
    events.push(system_event(
        config,
        &now,
        "database_size",
        if database_bytes > 1_073_741_824 {
            "warning"
        } else {
            "info"
        },
        &format!("bytes={database_bytes}"),
        Some(database_bytes as f64),
    ));
    Ok(events)
}

fn worker_severity(worker_present: bool, paused: bool) -> &'static str {
    if worker_present || paused {
        "info"
    } else {
        "error"
    }
}

async fn health_status() -> Result<String> {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        time::timeout,
    };
    let operation = async {
        let mut stream = TcpStream::connect("127.0.0.1:3100").await?;
        stream
            .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .await?;
        let mut response = [0_u8; 128];
        let count = stream.read(&mut response).await?;
        Ok::<_, anyhow::Error>(
            String::from_utf8_lossy(&response[..count])
                .lines()
                .next()
                .unwrap_or("empty response")
                .to_owned(),
        )
    };
    timeout(std::time::Duration::from_secs(2), operation)
        .await
        .map_err(|_| anyhow::anyhow!("timeout"))?
}

fn system_event(
    config: &ProjectConfig,
    timestamp: &str,
    code: &str,
    severity: &str,
    detail: &str,
    value: Option<f64>,
) -> Event {
    Event {
        event_key: util::key(&[code, timestamp, detail]),
        timestamp: timestamp.into(),
        source: "system".into(),
        category: "availability".into(),
        code: code.into(),
        severity: severity.into(),
        project: config.name.clone(),
        agent: None,
        task_id: None,
        session_id: None,
        duration_ms: None,
        input_tokens: None,
        output_tokens: None,
        cost_nano_aiu: None,
        value,
        detail: Some(detail.into()),
        pointer: None,
    }
}

#[cfg(test)]
mod tests {
    use super::worker_severity;

    #[test]
    fn paused_projects_do_not_require_worker_records() {
        assert_eq!(worker_severity(false, true), "info");
        assert_eq!(worker_severity(false, false), "error");
    }
}
