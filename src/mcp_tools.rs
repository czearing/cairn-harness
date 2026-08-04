use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use crate::{
    protocol::{BEGIN, parse_output},
    store::Store,
};

pub(crate) async fn call(
    store: &Store,
    agent: &str,
    leader: &str,
    idea_agents: &str,
    runtime_id: &str,
    request: &Value,
) -> Result<Value> {
    if !store.runtime_is_current(agent, runtime_id).await? {
        bail!("stale Harness agent runtime");
    }
    let name = required(&request["params"], "name")?;
    let arguments = &request["params"]["arguments"];
    invoke_with_idea_agents(store, agent, leader, idea_agents, name, arguments).await
}

pub async fn invoke(
    store: &Store,
    agent: &str,
    leader: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value> {
    invoke_with_idea_agents(store, agent, leader, "", name, arguments).await
}

pub async fn invoke_with_idea_agents(
    store: &Store,
    agent: &str,
    leader: &str,
    idea_agents: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value> {
    let id = match name {
        "task_create" => {
            store
                .create_from_generator(
                    agent,
                    leader,
                    required(arguments, "topic")?,
                    required(arguments, "body")?,
                )
                .await?
        }
        "task_delegate" => {
            if agent != leader {
                bail!("task_delegate is only available to the project leader");
            }
            let assignee = required(arguments, "to")?;
            if idea_agents
                .split(',')
                .any(|idea| !idea.is_empty() && assignee == idea)
            {
                bail!("idea agents cannot receive delegated tasks");
            }
            store
                .delegate_current_compatible(
                    agent,
                    assignee,
                    optional(arguments, "capability"),
                    required(arguments, "topic")?,
                    required(arguments, "body")?,
                )
                .await?
        }
        "task_complete" => {
            let result = required(arguments, "result")?;
            validate_completion_result(result)?;
            store.complete_current(agent, result).await?
        }
        "message_send" => {
            store
                .send_peer_message(
                    agent,
                    required(arguments, "to")?,
                    required(arguments, "topic")?,
                    required(arguments, "body")?,
                )
                .await?
        }
        _ => bail!("unknown tool {name}"),
    };
    Ok(json!({
        "content":[{"type":"text","text":format!("Committed {name}: {id}")}],
        "structuredContent":{"taskId":id},
        "isError":false
    }))
}

pub(crate) fn validate_completion_result(result: &str) -> Result<()> {
    if !result.contains(BEGIN) {
        if declares_incomplete_work(result) {
            bail!("task completion rejected: result declares incomplete work");
        }
        return Ok(());
    }
    let output = parse_output(result).context("invalid task completion result")?;
    if !output.complete {
        bail!("task completion rejected: result declares complete=false");
    }
    let evidence = format!(
        "{}\n{}",
        output.summary,
        output.deliverable.as_deref().unwrap_or_default()
    );
    if declares_incomplete_work(&evidence) {
        bail!("task completion rejected: result declares incomplete work");
    }
    Ok(())
}

fn declares_incomplete_work(result: &str) -> bool {
    let normalized = result.trim().to_ascii_lowercase();
    [
        "blocked:",
        "incomplete:",
        "not completed:",
        "no implementation was accepted",
        "no implementation was completed",
        "implementation is still required",
        "work was not completed",
        "could not complete",
        "unable to complete",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

pub async fn invoke_with_producer(
    store: &Store,
    agent: &str,
    leader: &str,
    producer: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value> {
    invoke_with_idea_agents(store, agent, leader, producer, name, arguments).await
}

fn required<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value[name]
        .as_str()
        .filter(|text| !text.trim().is_empty())
        .with_context(|| format!("{name} is required"))
}

fn optional<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    value[name]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
}
