use std::path::PathBuf;

use agent_client_protocol::schema::{
    ProtocolVersion,
    v1::{
        InitializeRequest, LoadSessionRequest, NewSessionResponse, RequestPermissionOutcome,
        RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    },
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use anyhow::{Result, anyhow};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::{config::CopilotConfig, models::WorkerSpec, persistent_runner::Job, store::Store};

pub async fn run(
    config: CopilotConfig,
    root: PathBuf,
    worker: WorkerSpec,
    session_id: String,
    jobs: mpsc::Receiver<Job>,
    ready: oneshot::Sender<Result<String>>,
) -> Result<()> {
    let runtime_id = Uuid::new_v4().to_string();
    let event_session_id = session_id.clone();
    let runtime_store = Store::open(&root.join(".cairn-harness").join("harness.db")).await?;
    runtime_store.set_runtime(&worker.id, &runtime_id).await?;
    runtime_store
        .record_runtime_event(
            "acp_started",
            "info",
            Some(&worker.id),
            None,
            Some(&event_session_id),
            &format!("runtime_id={runtime_id}"),
        )
        .await?;
    let runtime_agent = worker.id.clone();
    let runtime_cleanup_id = runtime_id.clone();
    prune_unreachable_sessions(&root, &worker.id, &session_id);
    let agent = agent(&config, &root, &worker, &runtime_id)?;
    let result: Result<()> = async {
        Client
            .builder()
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _connection| {
                    let id = request
                        .options
                        .first()
                        .map(|option| option.option_id.clone())
                        .ok_or_else(|| anyhow!("permission request had no options"))?;
                    responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id)),
                    ))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
                connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                if !session_id.is_empty() {
                    match connection
                        .send_request(LoadSessionRequest::new(session_id.clone(), &root))
                        .block_task()
                        .await
                    {
                        Ok(response) => {
                            let attached = NewSessionResponse::new(session_id.clone())
                                .modes(response.modes)
                                .config_options(response.config_options)
                                .meta(response.meta);
                            let session = connection.attach_session(attached, Vec::new())?;
                            return crate::acp_session::serve(session, root, worker, jobs, ready)
                                .await;
                        }
                        Err(error) => {
                            clear_incompatible_session(&root, &worker.id, &session_id).await?;
                            tracing::warn!(
                                agent = %worker.id,
                                session_id = %session_id,
                                %error,
                                "could not load persisted Copilot session; rotating the ACP session"
                            );
                        }
                    }
                }
                connection
                    .build_session(root.clone())
                    .block_task()
                    .run_until(async |session| {
                        crate::acp_session::serve(session, root, worker, jobs, ready).await
                    })
                    .await
            })
            .await?;
        Ok(())
    }
    .await;
    if let Err(error) = runtime_store
        .clear_runtime_if(&runtime_agent, &runtime_cleanup_id)
        .await
        && result.is_ok()
    {
        return Err(error);
    }
    let (severity, detail) = match &result {
        Ok(()) => ("info", "ACP process stopped normally".to_string()),
        Err(error) => ("error", format!("{error:#}")),
    };
    runtime_store
        .record_runtime_event(
            "acp_stopped",
            severity,
            Some(&runtime_agent),
            None,
            Some(&event_session_id),
            &detail,
        )
        .await?;
    result
}

async fn clear_incompatible_session(
    root: &std::path::Path,
    worker_id: &str,
    session_id: &str,
) -> Result<()> {
    let store = Store::open(&root.join(".cairn-harness").join("harness.db")).await?;
    store.clear_session_if(worker_id, session_id).await
}

/// Agents build inside their own session workspace, so unreachable sessions retain whole `target/`
/// trees. Reclaiming them at start keeps the project directory from growing without bound.
fn prune_unreachable_sessions(root: &std::path::Path, worker_id: &str, session_id: &str) {
    let copilot_home = root
        .join(".cairn-harness")
        .join("copilot-home")
        .join(worker_id);
    match crate::session_gc::prune(&copilot_home, session_id) {
        Ok(0) => {}
        Ok(reclaimed) => {
            tracing::info!(
                agent = %worker_id,
                reclaimed_bytes = reclaimed,
                "reclaimed unreachable Copilot session workspaces"
            )
        }
        Err(error) => {
            tracing::warn!(agent = %worker_id, %error, "could not reclaim session workspaces")
        }
    }
}

fn agent(
    config: &CopilotConfig,
    root: &std::path::Path,
    worker: &WorkerSpec,
    runtime_id: &str,
) -> Result<AcpAgent> {
    let copilot_home = root
        .join(".cairn-harness")
        .join("copilot-home")
        .join(&worker.id);
    std::fs::create_dir_all(&copilot_home)?;
    crate::acp_profile::sync(&copilot_home, root, worker)?;
    let args = crate::acp_launch::arguments(config, root, worker, runtime_id, &copilot_home)?;
    Ok(AcpAgent::from_args(args)?.with_debug(|line, direction| {
        if std::env::var_os("HARNESS_ACP_DEBUG").is_some() {
            eprintln!("{direction:?}: {line}");
        }
    }))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;
    use tempfile::tempdir;
    use tokio::sync::watch;

    use super::*;
    use crate::{
        models::RunRequest, persistent_runner::PersistentCopilotRunner, runner::AgentRunner,
    };

    #[tokio::test]
    async fn incompatible_restored_session_clears_only_its_persisted_id() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let store = Store::open(&root.join(".cairn-harness").join("harness.db"))
            .await
            .unwrap();
        let worker = WorkerSpec {
            id: "writer".into(),
            role: "writer".into(),
            description: "Writer".into(),
            prompt: "Write.".into(),
            model: "gpt-5.4-mini".into(),
            leader: "writer".into(),
            leader_task_limit: 3,
            idea_agents: Vec::new(),
            delegate_agents: Vec::new(),
        };
        store.register(&worker).await.unwrap();
        store
            .set_session(&worker.id, "restored-session")
            .await
            .unwrap();

        clear_incompatible_session(root, &worker.id, "restored-session")
            .await
            .unwrap();

        assert_eq!(store.agent(&worker.id).await.unwrap().session_id, "");
    }

    #[tokio::test]
    async fn restored_agent_reuses_its_session_without_a_readiness_deadlock() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("workspace");
        std::fs::create_dir_all(&root).unwrap();
        let script = temp.path().join("fake-acp.mjs");
        let calls = temp.path().join("calls.log");
        std::fs::write(&script, fake_acp()).unwrap();
        let store = Store::open(&root.join(".cairn-harness").join("harness.db"))
            .await
            .unwrap();
        let worker = WorkerSpec {
            id: "writer".into(),
            role: "writer".into(),
            description: "Writer".into(),
            prompt: "Write.".into(),
            model: "gpt-5.4-mini".into(),
            leader: "writer".into(),
            leader_task_limit: 3,
            idea_agents: Vec::new(),
            delegate_agents: Vec::new(),
        };
        store.register(&worker).await.unwrap();
        let config = CopilotConfig {
            executable: "node".into(),
            arguments: vec![
                script.to_string_lossy().into_owned(),
                calls.to_string_lossy().into_owned(),
            ],
            model: None,
            additional_mcp_config: None,
        };
        let first_runner = Arc::new(PersistentCopilotRunner::new(config.clone()));
        let first = first_runner
            .run(request(&root, &worker, "", "first prompt"))
            .await
            .unwrap();
        assert_eq!(first.summary, "fake ACP completed");
        assert_eq!(
            store.agent(&worker.id).await.unwrap().session_id,
            "stable-session"
        );

        let task_id = store
            .create_message("human", &worker.id, "coordinate", "Complete through MCP.")
            .await
            .unwrap();
        store.claim(&worker.id).await.unwrap().unwrap();
        let restored_runner = PersistentCopilotRunner::new(config);
        let restored = restored_runner
            .run(request(&root, &worker, "stable-session", "restored prompt"))
            .await
            .unwrap();
        assert_eq!(restored.summary, "fake ACP completed");
        crate::mcp_server::invoke(
            &store,
            &worker.id,
            &worker.id,
            "task_complete",
            &json!({"result":"restored coordination succeeded"}),
        )
        .await
        .unwrap();

        assert_eq!(store.task_status(&task_id).await.unwrap(), "completed");
        assert_eq!(
            store.agent(&worker.id).await.unwrap().session_id,
            "stable-session"
        );
        let calls = std::fs::read_to_string(calls).unwrap();
        assert_eq!(calls.matches("session/new").count(), 1);
        assert_eq!(calls.matches("session/load").count(), 1);
        assert!(calls.contains("session/new mcp=false"));
        assert!(calls.contains("session/load mcp=false"));
        assert!(calls.contains("model=gpt-5.4-mini"));
        assert_eq!(calls.matches("tools/list ready").count(), 0);
    }

    #[tokio::test]
    async fn blocked_stop_continues_the_same_session_without_replaying_the_assignment() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("workspace");
        std::fs::create_dir_all(&root).unwrap();
        let script = temp.path().join("blocked-stop-acp.mjs");
        let calls = temp.path().join("blocked-stop-calls.log");
        std::fs::write(&script, blocked_stop_acp()).unwrap();
        let store = Store::open(&root.join(".cairn-harness").join("harness.db"))
            .await
            .unwrap();
        let worker = WorkerSpec {
            id: "writer".into(),
            role: "writer".into(),
            description: "Writer".into(),
            prompt: "Write.".into(),
            model: "gpt-5.4-mini".into(),
            leader: "writer".into(),
            leader_task_limit: 3,
            idea_agents: Vec::new(),
            delegate_agents: Vec::new(),
        };
        store.register(&worker).await.unwrap();
        let runner = PersistentCopilotRunner::new(CopilotConfig {
            executable: "node".into(),
            arguments: vec![
                script.to_string_lossy().into_owned(),
                calls.to_string_lossy().into_owned(),
            ],
            model: None,
            additional_mcp_config: None,
        });

        let output = runner
            .run(request(&root, &worker, "", "original assignment"))
            .await
            .unwrap();

        assert_eq!(output.summary, "continued in place");
        let calls = std::fs::read_to_string(calls).unwrap();
        assert_eq!(calls.matches("session/new").count(), 1);
        assert_eq!(calls.matches("session/prompt").count(), 2);
        assert_eq!(calls.matches("original assignment").count(), 1);
        assert_eq!(calls.matches("Finish every requested task.").count(), 1);
    }

    fn request(
        root: &std::path::Path,
        worker: &WorkerSpec,
        session_id: &str,
        prompt: &str,
    ) -> RunRequest {
        RunRequest {
            project_root: root.to_path_buf(),
            worker: worker.clone(),
            session_id: session_id.into(),
            composed: crate::prompt::Composed::body(prompt),
            prior_context: None,
            delivered: Default::default(),
            cancellation: watch::channel(false).1,
        }
    }

    fn fake_acp() -> &'static str {
        r#"import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const calls = process.argv[2];
const input = readline.createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const record = (value) => fs.appendFileSync(calls, value + "\n");
record(`model=${process.env.CAIRN_MODEL || ""}`);
const serverEnv = (server, name) => {
  if (Array.isArray(server?.env)) return server.env.find((entry) => entry.name === name)?.value;
  return server?.env?.[name];
};
const writeTurn = (sessionId) => {
  const directory = path.join(process.env.COPILOT_HOME, "session-state", sessionId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "cairn-compliance.json"), JSON.stringify({
    sessionId,
    rootNodeId: "fake-root",
  }));
  fs.appendFileSync(path.join(directory, "events.jsonl"), JSON.stringify({
    type: "assistant.message",
    timestamp: new Date().toISOString(),
    data: { content: "CAIRN_ENVELOPE_BEGIN\n{\"summary\":\"fake ACP completed\",\"deliverable\":null,\"complete\":true}\nCAIRN_ENVELOPE_END" },
  }) + "\n" + JSON.stringify({
    type: "hook.end",
    timestamp: new Date().toISOString(),
    data: { hookType: "agentStop", output: { decision: "allow" } },
  }) + "\n");
};

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    reply(request.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "fake-acp", version: "1" },
    });
  } else if (request.method === "session/new") {
    const server = request.params.mcpServers.find((candidate) => candidate.name === "cairn-harness");
    record(`session/new mcp=${Boolean(server)}`);
    reply(request.id, { sessionId: "stable-session" });
  } else if (request.method === "session/load") {
    const server = request.params.mcpServers.find((candidate) => candidate.name === "cairn-harness");
    record(`session/load mcp=${Boolean(server)}`);
    reply(request.id, {});
    const ready = serverEnv(server, "CAIRN_HARNESS_READY_FILE");
    setTimeout(() => {
      fs.mkdirSync(path.dirname(ready), { recursive: true });
      fs.writeFileSync(ready, "ready");
      record("tools/list ready");
    }, 50);
  } else if (request.method === "session/prompt") {
    writeTurn(request.params.sessionId);
    reply(request.id, { stopReason: "end_turn" });
  }
});
"#
    }

    fn blocked_stop_acp() -> &'static str {
        r#"import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const calls = process.argv[2];
const input = readline.createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const record = (value) => fs.appendFileSync(calls, value + "\n");
let prompts = 0;
const writeEvents = (sessionId, events) => {
  const directory = path.join(process.env.COPILOT_HOME, "session-state", sessionId);
  fs.mkdirSync(directory, { recursive: true });
  fs.appendFileSync(path.join(directory, "events.jsonl"), events.map(JSON.stringify).join("\n") + "\n");
};

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    reply(request.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "blocked-stop-acp", version: "1" },
    });
  } else if (request.method === "session/new") {
    record("session/new");
    reply(request.id, { sessionId: "same-session" });
  } else if (request.method === "session/prompt") {
    prompts += 1;
    record(`session/prompt ${JSON.stringify(request.params.prompt)}`);
    if (prompts === 1) {
      writeEvents(request.params.sessionId, [
        { type: "assistant.message", data: { content: "stopped too early" } },
        { type: "hook.end", data: { hookType: "agentStop", output: {
          decision: "block",
          reason: "Finish every requested task.",
        } } },
      ]);
    } else {
      writeEvents(request.params.sessionId, [
        { type: "assistant.message", data: {
          content: "CAIRN_ENVELOPE_BEGIN\n{\"summary\":\"continued in place\",\"deliverable\":null,\"complete\":false}\nCAIRN_ENVELOPE_END",
        } },
        { type: "hook.end", data: { hookType: "agentStop", output: { decision: "allow" } } },
      ]);
    }
    reply(request.id, { stopReason: "end_turn" });
  } else if (request.method === "session/cancel") {
    reply(request.id, {});
  }
});
"#
    }
}
