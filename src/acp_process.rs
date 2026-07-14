use std::path::PathBuf;

use agent_client_protocol::schema::{
    ProtocolVersion,
    v1::{
        InitializeRequest, LoadSessionRequest, NewSessionResponse, RequestPermissionOutcome,
        RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    },
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use anyhow::{Context, Result, anyhow};
use tokio::sync::{mpsc, oneshot};

use crate::{config::CopilotConfig, models::WorkerSpec, persistent_runner::Job, shell_command};

pub async fn run(
    config: CopilotConfig,
    root: PathBuf,
    worker: WorkerSpec,
    session_id: String,
    jobs: mpsc::Receiver<Job>,
    ready: oneshot::Sender<Result<String>>,
) -> Result<()> {
    let agent = agent(&config, &root, &worker)?;
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
            if !session_id.is_empty()
                && let Ok(response) = connection
                    .send_request(LoadSessionRequest::new(session_id.clone(), &root))
                    .block_task()
                    .await
            {
                let attached = NewSessionResponse::new(session_id)
                    .modes(response.modes)
                    .meta(response.meta);
                let session = connection.attach_session(attached, Vec::new())?;
                return crate::acp_session::serve(session, root, worker, jobs, ready, true).await;
            }
            connection
                .build_session(root.clone())
                .block_task()
                .run_until(async |session| {
                    crate::acp_session::serve(session, root, worker, jobs, ready, false).await
                })
                .await
        })
        .await?;
    Ok(())
}

fn agent(config: &CopilotConfig, root: &std::path::Path, worker: &WorkerSpec) -> Result<AcpAgent> {
    let copilot_home = root
        .join(".cairn-harness")
        .join("copilot-home")
        .join(&worker.id);
    std::fs::create_dir_all(&copilot_home)?;
    sync_profile(&copilot_home)?;
    let mut args = vec![
        "AGENT_HARNESS=1".into(),
        format!("COPILOT_HOME={}", copilot_home.display()),
    ];
    args.extend(shell_command::argv(&config.executable));
    args.extend(config.arguments.clone());
    args.extend([
        "--acp".into(),
        "--allow-all-tools".into(),
        "--no-color".into(),
    ]);
    if let Some(path) = &config.additional_mcp_config {
        let path = path.to_string_lossy().replace('\\', "/");
        args.extend(["--additional-mcp-config".into(), format!("@{path}")]);
    }
    if let Some(model) = &config.model {
        args.extend(["--model".into(), model.clone()]);
    }
    Ok(AcpAgent::from_args(args)?.with_debug(|line, direction| {
        if std::env::var_os("HARNESS_ACP_DEBUG").is_some() {
            eprintln!("{direction:?}: {line}");
        }
    }))
}

fn sync_profile(destination: &std::path::Path) -> Result<()> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .context("home directory is unavailable")?;
    let source = PathBuf::from(home).join(".copilot");
    for name in [
        "mcp-config.json",
        "config.json",
        "settings.json",
        "permissions-config.json",
    ] {
        let from = source.join(name);
        if from.is_file() {
            std::fs::copy(from, destination.join(name))?;
        }
    }
    copy_dir(&source.join("hooks"), &destination.join("hooks"))
}

fn copy_dir(source: &std::path::Path, destination: &std::path::Path) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
