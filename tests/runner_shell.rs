use std::path::PathBuf;

use cairn_harness::{
    config::CopilotConfig,
    models::{RunRequest, WorkerSpec},
    runner::{AgentRunner, CopilotRunner},
};
use tempfile::tempdir;
use uuid::Uuid;

#[tokio::test]
async fn parses_protocol_from_an_isolated_shell_process() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("fake-copilot.ps1");
    let arguments = temp.path().join("arguments.txt");
    std::fs::write(
        &script,
        "param([string]$LogPath)\n\
         $args | Set-Content -Path $LogPath\n\
         Write-Output 'CAIRN_ENVELOPE_BEGIN'\n\
         Write-Output '{\"summary\":\"shell ok\",\"messages\":[],\"complete\":true}'\n\
         Write-Output 'CAIRN_ENVELOPE_END'\n",
    )
    .unwrap();
    let runner = CopilotRunner::new(CopilotConfig {
        executable: PathBuf::from("powershell"),
        arguments: vec![
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-File".into(),
            script.display().to_string(),
            arguments.display().to_string(),
        ],
        model: None,
        max_autopilot_continues: 1,
        max_ai_credits: 1.0,
        allow_all_tools: false,
        include_mcp_instructions: false,
        denied_tools: Vec::new(),
        additional_mcp_config: None,
    });
    let output = runner
        .run(RunRequest {
            project_root: temp.path().into(),
            worker: WorkerSpec {
                id: "pm".into(),
                role: "pm".into(),
                contract: "lead".into(),
                owns: Vec::new(),
            },
            session_id: Uuid::new_v4().to_string(),
            prompt: "test".into(),
        })
        .await
        .unwrap();

    assert_eq!(output.summary, "shell ok");
    assert!(output.complete);
    let arguments = std::fs::read_to_string(arguments).unwrap();
    assert!(arguments.contains("--autopilot"));
    assert!(arguments.contains("--session-id"));
    assert!(arguments.contains("--max-ai-credits"));
}
