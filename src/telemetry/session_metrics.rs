use std::path::Path;

use serde_json::Value;

use crate::config::ProjectConfig;

use super::{model::Event, util};

pub fn project(
    config: &ProjectConfig,
    path: &Path,
    line: usize,
    agent: Option<String>,
    session: Option<String>,
    value: &Value,
) -> Option<Event> {
    let timestamp = value["timestamp"].as_str().unwrap_or_default();
    let data = &value["data"];
    let (code, input, output, cost, detail) = match value["type"].as_str()? {
        "assistant.message" => (
            "assistant_output",
            None,
            data["outputTokens"].as_i64(),
            None,
            data["model"].as_str().unwrap_or("unknown"),
        ),
        "user.message" => {
            let bytes = data["content"].as_str().map_or(0, str::len);
            (
                "user_input_estimate",
                Some(util::estimate_tokens(bytes)),
                None,
                None,
                "content length estimate",
            )
        }
        "session.usage_checkpoint" => (
            "usage_checkpoint",
            None,
            None,
            data["totalNanoAiu"].as_i64(),
            "session cumulative",
        ),
        _ => return None,
    };
    Some(Event {
        event_key: util::key(&[code, timestamp, session.as_deref().unwrap_or("")]),
        timestamp: timestamp.into(),
        source: "copilot_session".into(),
        category: if cost.is_some() { "cost" } else { "tokens" }.into(),
        code: code.into(),
        severity: "info".into(),
        project: config.name.clone(),
        agent,
        task_id: None,
        session_id: session,
        duration_ms: None,
        input_tokens: input,
        output_tokens: output,
        cost_nano_aiu: cost,
        value: input.or(output).or(cost).map(|value| value as f64),
        detail: Some(detail.into()),
        pointer: Some(format!("{}:{line}", path.display())),
    })
}
