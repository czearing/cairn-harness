use std::path::PathBuf;

use cairn_harness::{
    config::CopilotConfig,
    models::{RunRequest, WorkerSpec},
    runner::{AgentRunner, CopilotRunner},
};
use tempfile::tempdir;
use uuid::Uuid;

#[tokio::test]
#[cfg(windows)]
async fn parses_protocol_from_an_isolated_shell_process() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("fake-copilot.ps1");
    let arguments = temp.path().join("arguments.txt");
    std::fs::write(
        &script,
        "param([string]$LogPath)\n\
         $args | Set-Content -Path $LogPath\n\
         Write-Output 'CAIRN_ENVELOPE_BEGIN'\n\
         Write-Output '{\"summary\":\"shell ok\",\"complete\":true}'\n\
         Write-Output 'CAIRN_ENVELOPE_END'\n",
    )
    .unwrap();
    let runner = CopilotRunner::new(CopilotConfig {
        executable: PathBuf::from(&script),
        arguments: vec![arguments.display().to_string()],
        model: None,
        additional_mcp_config: None,
    });
    let output = runner
        .run(RunRequest {
            project_root: temp.path().into(),
            worker: WorkerSpec {
                id: "pm".into(),
                role: "pm".into(),
                description: "Product lead".into(),
                prompt: "Lead the work.".into(),
                model: "gpt-5.6-sol".into(),
                leader: "pm".into(),
                leader_task_limit: 3,
                idea_agents: Vec::new(),
                delegate_agents: Vec::new(),
            },
            session_id: Uuid::new_v4().to_string(),
            prompt: "test".into(),
            fresh_session_prompt: None,
            cancellation: tokio::sync::watch::channel(false).1,
        })
        .await
        .unwrap();

    assert_eq!(output.summary, "shell ok");
    assert!(output.complete);
    let arguments = std::fs::read_to_string(arguments).unwrap();
    assert!(!arguments.contains("--autopilot"));
    assert!(arguments.contains("--session-id"));
    assert!(!arguments.contains("--max-ai-credits"));
    assert!(arguments.contains("--no-color"));
}

#[tokio::test]
#[cfg(windows)]
async fn one_shell_run_is_bounded_and_argument_safe() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("fake-copilot.ps1");
    std::fs::write(
        &script,
        "Write-Output 'CAIRN_ENVELOPE_BEGIN'\n\
         Write-Output '{\"summary\":\"one\",\"deliverable\":null,\"complete\":true}'\n\
         Write-Output 'CAIRN_ENVELOPE_END'\n",
    )
    .unwrap();
    let runner = CopilotRunner::new(CopilotConfig {
        executable: script,
        arguments: Vec::new(),
        model: None,
        additional_mcp_config: None,
    });
    let output = runner.run(request(temp.path())).await.unwrap();
    assert_eq!(output.summary, "one");
}

fn request(root: &std::path::Path) -> RunRequest {
    RunRequest {
        project_root: root.into(),
        worker: WorkerSpec {
            id: "pm".into(),
            role: "pm".into(),
            description: "Lead".into(),
            prompt: "Lead.".into(),
            model: "gpt-5.6-sol".into(),
            leader: "pm".into(),
            leader_task_limit: 3,
            idea_agents: Vec::new(),
            delegate_agents: Vec::new(),
        },
        session_id: Uuid::new_v4().to_string(),
        prompt: "test".into(),
        fresh_session_prompt: None,
        cancellation: tokio::sync::watch::channel(false).1,
    }
}
