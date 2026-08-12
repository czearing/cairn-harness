use std::{env, path::PathBuf};

use anyhow::{Context, Result};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::mcp_tools::call;
pub use crate::mcp_tools::{invoke, invoke_with_idea_agents, invoke_with_producer};
use crate::store::Store;

pub async fn run() -> Result<()> {
    let database = PathBuf::from(env::var("CAIRN_HARNESS_DB").context("missing harness database")?);
    let agent = env::var("CAIRN_HARNESS_AGENT").context("missing harness agent")?;
    let leader = env::var("CAIRN_HARNESS_LEADER").context("missing harness leader")?;
    let idea_agents = env::var("CAIRN_HARNESS_IDEA_AGENTS").unwrap_or_default();
    let delegate_agents = env::var("CAIRN_HARNESS_DELEGATE_AGENTS").unwrap_or_default();
    let runtime_id =
        env::var("CAIRN_HARNESS_RUNTIME_ID").context("missing harness runtime identity")?;
    let store = Store::open(&database).await?;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut output = tokio::io::stdout();
    while let Some(line) = lines.next_line().await? {
        let request: Value = serde_json::from_str(&line)?;
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let result = match request["method"].as_str() {
            Some("initialize") => initialize(&request),
            Some("tools/list") => {
                mark_ready()?;
                tools(&agent, &leader, &idea_agents, &delegate_agents)
            }

            Some("tools/call") => {
                call(
                    &store,
                    &agent,
                    &leader,
                    &idea_agents,
                    &delegate_agents,
                    &runtime_id,
                    &request,
                )
                .await
            }
            _ => Err(anyhow::anyhow!("unsupported method")),
        };
        let response = match result {
            Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":value}),
            Err(error) => json!({
                "jsonrpc":"2.0","id":id,
                "result":{"content":[{"type":"text","text":format!("{error:#}")}],"isError":true}
            }),
        };
        output
            .write_all(serde_json::to_string(&response)?.as_bytes())
            .await?;
        output.write_all(b"\n").await?;
        output.flush().await?;
    }

    Ok(())
}

pub async fn invoke_from_environment(name: &str, arguments: Value) -> Result<Value> {
    let database = PathBuf::from(env::var("CAIRN_HARNESS_DB").context("missing harness database")?);
    let agent = env::var("CAIRN_HARNESS_AGENT").context("missing harness agent")?;
    let leader = env::var("CAIRN_HARNESS_LEADER").context("missing harness leader")?;
    let idea_agents = env::var("CAIRN_HARNESS_IDEA_AGENTS").unwrap_or_default();
    let delegate_agents = env::var("CAIRN_HARNESS_DELEGATE_AGENTS").unwrap_or_default();
    let runtime_id =
        env::var("CAIRN_HARNESS_RUNTIME_ID").context("missing harness runtime identity")?;
    let store = Store::open(&database).await?;
    let request = json!({"params":{"name":name,"arguments":arguments}});
    call(
        &store,
        &agent,
        &leader,
        &idea_agents,
        &delegate_agents,
        &runtime_id,
        &request,
    )
    .await
}

fn mark_ready() -> Result<()> {
    mark_ready_at(env::var_os("CAIRN_HARNESS_READY_FILE"))
}

fn mark_ready_at(file: Option<std::ffi::OsString>) -> Result<()> {
    let Some(file) = file else {
        return Ok(());
    };
    std::fs::write(PathBuf::from(file), b"ready")?;
    Ok(())
}

fn initialize(request: &Value) -> Result<Value> {
    Ok(json!({
        "protocolVersion": request["params"]["protocolVersion"]
            .as_str().unwrap_or("2025-11-25"),
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "cairn-harness", "version": env!("CARGO_PKG_VERSION")}
    }))
}

/// The tool list is scoped per agent identity so that non-leader workers
/// never see delegation or messaging tools in `tools/list`: they aren't
/// just blocked at call time, they have no visibility that the capability
/// exists at all. `team_status` is the one exception: every agent, leader
/// or worker, can call it to check what the rest of the team is doing.
fn tools(agent: &str, leader: &str, idea_agents: &str, delegate_agents: &str) -> Result<Value> {
    let is_leader = agent == leader;
    let is_idea_agent = idea_agents
        .split(',')
        .any(|idea| !idea.is_empty() && idea == agent);
    let is_delegate = is_leader
        || delegate_agents
            .split(',')
            .any(|delegate| !delegate.is_empty() && delegate == agent);
    let mut list = Vec::new();
    if is_leader || is_idea_agent {
        list.push(tool("task_create", "Create durable work when the dashboard user asks, or create the next automatic root task. Always set 'to' to the exact peer agent id (see your Peers list) that should receive this work; you are the delegator and must choose explicitly.", json!({
            "type":"object","additionalProperties":false,
            "properties":{
                "to":{"type":"string"},
                "topic":{"type":"string"},
                "body":{"type":"string"}
            },"required":["to","topic","body"]
        })));
    }
    if is_delegate {
        list.push(tool("task_delegate", "Delegate one distinct, role-matched subtask; never pass on or duplicate your assignment.", json!({
            "type":"object","additionalProperties":false,
            "properties":{
                "to":{"type":"string"},
                "capability":{"type":"string"},
                "topic":{"type":"string"},
                "body":{"type":"string"}
            },"required":["to","topic","body"]
        })));
        list.push(tool("message_send", "Send a necessary direct peer request or new information; no acknowledgements or result relays.", json!({
            "type":"object","additionalProperties":false,
            "properties":{
                "to":{"type":"string"},
                "topic":{"type":"string"},
                "body":{"type":"string"}
            },"required":["to","topic","body"]
        })));
    }
    list.push(tool("team_status", "Check the current status of every agent on the team (idle/working, current topic, pending and buffered task counts) and any other active root tasks. Read-only; does not notify or contact anyone.", json!({
        "type":"object","additionalProperties":false,
        "properties":{}
    })));
    Ok(json!({ "tools": list }))
}

fn tool(name: &str, description: &str, input: Value) -> Value {
    json!({"name":name,"description":description,"inputSchema":input})
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::{mcp_tools_helpers::validate_completion_result, models::WorkerSpec, protocol::BEGIN};

    #[test]
    fn tool_listing_marks_the_server_ready() {
        let directory = tempdir().unwrap();
        let file = directory.path().join("ready");

        mark_ready_at(Some(file.clone().into_os_string())).unwrap();

        assert_eq!(std::fs::read(file).unwrap(), b"ready");
    }

    #[test]
    fn task_delegate_schema_accepts_an_optional_capability() {
        let tools = tools("leader", "leader", "", "").unwrap();
        let delegation = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "task_delegate")
            .unwrap();

        assert_eq!(
            delegation["inputSchema"]["properties"]["capability"]["type"],
            "string"
        );
        assert!(
            !delegation["inputSchema"]["required"]
                .as_array()
                .unwrap()
                .contains(&json!("capability"))
        );
    }

    #[test]
    fn task_complete_is_not_agent_visible() {
        let tools = tools("leader", "leader", "", "").unwrap();
        assert!(
            !tools["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool["name"] == "task_complete")
        );
    }

    #[test]
    fn workers_cannot_see_delegation_or_messaging_tools() {
        let tools = tools("implementer", "leader", "", "").unwrap();
        let names: Vec<_> = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();

        assert_eq!(names, vec!["team_status"]);
    }

    #[test]
    fn idea_agents_can_create_work_but_not_delegate_or_message() {
        let tools = tools("idea-generator", "leader", "idea-generator", "").unwrap();
        let names: Vec<_> = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();

        assert_eq!(names, vec!["task_create", "team_status"]);
    }

    #[test]
    fn delegate_agents_can_delegate_and_message_without_being_leader() {
        let tools = tools("implementer", "leader", "", "implementer").unwrap();
        let names: Vec<_> = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();

        assert_eq!(names, vec!["task_delegate", "message_send", "team_status"]);
    }

    #[test]
    fn agents_outside_the_delegate_list_still_cannot_delegate_or_message() {
        let tools = tools("implementer-2", "leader", "", "implementer").unwrap();
        let names: Vec<_> = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();

        assert_eq!(names, vec!["team_status"]);
    }

    #[test]
    fn every_agent_can_see_team_status() {
        for (agent, leader) in [("leader", "leader"), ("implementer", "leader")] {
            let tools = tools(agent, leader, "", "").unwrap();
            assert!(
                tools["tools"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|tool| tool["name"] == "team_status")
            );
        }
    }

    #[test]
    fn rejects_incomplete_completion_envelopes() {
        let result = format!(
            "{BEGIN}\n{{\"summary\":\"Blocked.\",\"deliverable\":null,\"complete\":false}}\n{}",
            crate::protocol::END
        );

        let error = validate_completion_result(&result).unwrap_err();

        assert!(error.to_string().contains("result declares complete=false"));
    }

    #[test]
    fn accepts_complete_and_legacy_completion_results() {
        let complete = format!(
            "{BEGIN}\n{{\"summary\":\"Done.\",\"deliverable\":\"Changed files.\",\"complete\":true}}\n{}",
            crate::protocol::END
        );

        validate_completion_result(&complete).unwrap();
        validate_completion_result("legacy completed result").unwrap();
    }

    #[test]
    fn rejects_legacy_blocked_results() {
        let error =
            validate_completion_result("Blocked: no implementation was delegated.").unwrap_err();

        assert!(error.to_string().contains("declares incomplete work"));
    }

    #[test]
    fn rejects_complete_envelopes_that_admit_non_delivery() {
        let result = format!(
            "{BEGIN}\n{{\"summary\":\"Completed: work-item\",\"deliverable\":\"No implementation was accepted because engineers were busy. Implementation is still required.\",\"complete\":true}}\n{}",
            crate::protocol::END
        );

        let error = validate_completion_result(&result).unwrap_err();

        assert!(error.to_string().contains("declares incomplete work"));
    }

    #[tokio::test]
    async fn incomplete_tool_result_does_not_complete_the_claimed_task() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        store
            .register(&WorkerSpec {
                id: "leader".into(),
                role: "leader".into(),
                description: "Leads work.".into(),
                prompt: "Lead.".into(),
                model: "gpt-5.4-mini".into(),
                leader: "leader".into(),
                leader_task_limit: 1,
                idea_agents: Vec::new(),
                delegate_agents: Vec::new(),
            })
            .await
            .unwrap();
        let task_id = store
            .create_message("human", "leader", "work-item", "Implement the UI.")
            .await
            .unwrap();
        store.claim("leader").await.unwrap().unwrap();
        let result = format!(
            "{BEGIN}\n{{\"summary\":\"Blocked.\",\"deliverable\":null,\"complete\":false}}\n{}",
            crate::protocol::END
        );

        let error = invoke(
            &store,
            "leader",
            "leader",
            "task_complete",
            &json!({ "result": result }),
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("complete=false"));
        assert_eq!(store.task_status(&task_id).await.unwrap(), "claimed");
    }

    #[tokio::test]
    async fn stale_runtime_cannot_call_harness_tools() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        store
            .register(&WorkerSpec {
                id: "leader".into(),
                role: "leader".into(),
                description: "Leads work.".into(),
                prompt: "Lead.".into(),
                model: "gpt-5.4-mini".into(),
                leader: "leader".into(),
                leader_task_limit: 1,
                idea_agents: Vec::new(),
                delegate_agents: Vec::new(),
            })
            .await
            .unwrap();
        store.set_runtime("leader", "current").await.unwrap();
        let request = json!({
            "params": {"name": "unknown", "arguments": {}}
        });

        let error = call(&store, "leader", "leader", "", "", "stale", &request)
            .await
            .unwrap_err();

        assert!(error.to_string().contains("stale Harness agent runtime"));
    }

    #[tokio::test]
    async fn current_runtime_can_reach_harness_tools() {
        let directory = tempdir().unwrap();
        let store = Store::open(&directory.path().join("harness.db"))
            .await
            .unwrap();
        store
            .register(&WorkerSpec {
                id: "leader".into(),
                role: "leader".into(),
                description: "Leads work.".into(),
                prompt: "Lead.".into(),
                model: "gpt-5.4-mini".into(),
                leader: "leader".into(),
                leader_task_limit: 1,
                idea_agents: Vec::new(),
                delegate_agents: Vec::new(),
            })
            .await
            .unwrap();
        store.set_runtime("leader", "current").await.unwrap();
        let request = json!({
            "params": {"name": "unknown", "arguments": {}}
        });

        let error = call(&store, "leader", "leader", "", "", "current", &request)
            .await
            .unwrap_err();

        assert!(error.to_string().contains("unknown tool"));
    }

    #[tokio::test]
    async fn opens_capacity_policy_created_before_leader_column() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("harness.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&database)
            .create_if_missing(true);
        let pool = sqlx::SqlitePool::connect_with(options).await.unwrap();
        sqlx::raw_sql(
            "CREATE TABLE root_task_policy (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                max_active_tasks INTEGER NOT NULL
            );
            INSERT INTO root_task_policy(singleton,max_active_tasks) VALUES(1,2);",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool.close().await;

        let store = Store::open(&database).await.unwrap();
        let row: (i64, String) = sqlx::query_as(
            "SELECT max_active_tasks,leader FROM root_task_policy WHERE singleton=1",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap();

        assert_eq!(row, (2, String::new()));
    }
}
