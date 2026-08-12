use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::{
    mcp_tools_helpers::{optional, required, validate_completion_result},
    store::Store,
};

pub(crate) async fn call(
    store: &Store,
    agent: &str,
    leader: &str,
    idea_agents: &str,
    delegate_agents: &str,
    runtime_id: &str,
    request: &Value,
) -> Result<Value> {
    if !store.runtime_is_current(agent, runtime_id).await? {
        bail!("stale Harness agent runtime");
    }
    let name = required(&request["params"], "name")?;
    let arguments = &request["params"]["arguments"];
    invoke_with_idea_agents(
        store,
        agent,
        leader,
        idea_agents,
        delegate_agents,
        name,
        arguments,
    )
    .await
}

pub async fn invoke(
    store: &Store,
    agent: &str,
    leader: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value> {
    invoke_with_idea_agents(store, agent, leader, "", "", name, arguments).await
}

pub async fn invoke_with_idea_agents(
    store: &Store,
    agent: &str,
    leader: &str,
    idea_agents: &str,
    delegate_agents: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value> {
    let is_delegate = agent == leader
        || delegate_agents
            .split(',')
            .any(|delegate| !delegate.is_empty() && delegate == agent);
    if name == "team_status" {
        let status = store.team_status().await?;
        let structured: Value = serde_json::from_str(&status)?;
        return Ok(json!({
            "content":[{"type":"text","text":status}],
            "structuredContent":structured,
            "isError":false
        }));
    }
    let id = match name {
        "task_create" => {
            if agent != leader
                && !idea_agents
                    .split(',')
                    .any(|idea| !idea.is_empty() && idea == agent)
            {
                bail!("task_create is only available to the project leader or an idea agent");
            }
            let to = optional(arguments, "to");
            if let Some(assignee) = to {
                if idea_agents
                    .split(',')
                    .any(|idea| !idea.is_empty() && assignee == idea)
                {
                    bail!("idea agents cannot receive delegated tasks");
                }
            }
            store
                .create_from_generator(
                    agent,
                    leader,
                    to,
                    required(arguments, "topic")?,
                    required(arguments, "body")?,
                )
                .await?
        }
        "task_delegate" => {
            if !is_delegate {
                bail!("task_delegate is only available to the project leader or an agent granted delegation capability");
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
            if !is_delegate {
                bail!("message_send is only available to the project leader or an agent granted delegation capability");
            }
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

pub async fn invoke_with_producer(
    store: &Store,
    agent: &str,
    leader: &str,
    producer: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value> {
    invoke_with_idea_agents(store, agent, leader, producer, "", name, arguments).await
}
