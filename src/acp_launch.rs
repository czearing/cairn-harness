use anyhow::Result;

use crate::{config::CopilotConfig, models::WorkerSpec, shell_command};

/// Built-in Copilot tools Harness forbids, enforced at launch rather than in prose.
///
/// Harness resumes an agent when its children finish, so sub-agent and
/// agent-polling tools are prohibited. The prohibition used to be prose repeated
/// in every turn prompt, which asked for compliance instead of enforcing it.
/// Copilot CLI has no persistent deny list (github/copilot-cli#3995), so these
/// have to be passed on every launch.
pub(crate) const DENIED_TOOLS: [&str; 4] = ["Task", "read_agent", "write_agent", "list_agents"];

/// The full environment-and-argument vector used to start one agent's Copilot CLI.
pub(crate) fn arguments(
    config: &CopilotConfig,
    root: &std::path::Path,
    worker: &WorkerSpec,
    runtime_id: &str,
    copilot_home: &std::path::Path,
) -> Result<Vec<String>> {
    let mut args = vec![
        "AGENT_HARNESS=1".into(),
        format!("COPILOT_HOME={}", copilot_home.display()),
        format!("CAIRN_MODEL={}", worker.model),
        format!(
            "CAIRN_HARNESS_DB={}",
            root.join(".cairn-harness").join("harness.db").display()
        ),
        format!("CAIRN_HARNESS_AGENT={}", worker.id),
        format!("CAIRN_HARNESS_LEADER={}", worker.leader),
        format!("CAIRN_HARNESS_IDEA_AGENTS={}", worker.idea_agents.join(",")),
        format!(
            "CAIRN_HARNESS_DELEGATE_AGENTS={}",
            worker.delegate_agents.join(",")
        ),
        format!("CAIRN_HARNESS_RUNTIME_ID={runtime_id}"),
        format!(
            "CAIRN_HARNESS_EXECUTABLE={}",
            std::env::current_exe()?.display()
        ),
    ];
    args.extend(crate::cairn_scope::process_environment(root));
    args.extend(shell_command::argv(&config.executable));
    args.extend(config.arguments.clone());
    args.extend(["--acp".into(), "--no-color".into()]);
    let path = crate::mcp_config::write(root, worker, config, runtime_id)?;
    let path = path.to_string_lossy().replace('\\', "/");
    args.extend(["--additional-mcp-config".into(), format!("@{path}")]);
    args.extend(["--model".into(), worker.model.clone()]);
    for tool in DENIED_TOOLS {
        args.extend(["--deny-tool".into(), tool.into()]);
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn worker() -> WorkerSpec {
        WorkerSpec {
            id: "writer".into(),
            role: "writer".into(),
            description: "Write".into(),
            prompt: "Write.".into(),
            model: "gpt-5.4-mini".into(),
            leader: "lead".into(),
            leader_task_limit: 3,
            idea_agents: Vec::new(),
            delegate_agents: Vec::new(),
        }
    }

    #[test]
    fn every_prohibited_tool_is_denied_at_launch() {
        let temp = tempdir().unwrap();
        let home = temp.path().join("copilot-home");
        std::fs::create_dir_all(&home).unwrap();
        let profile = crate::mcp_path::profile(temp.path(), &worker());
        std::fs::create_dir_all(&profile).unwrap();
        std::fs::write(
            profile.join("mcp-config.json"),
            r#"{"mcpServers":{"cairn":{"type":"local","command":"cairn","args":["mcp"],"env":{}}}}"#,
        )
        .unwrap();

        let args = arguments(
            &CopilotConfig::default(),
            temp.path(),
            &worker(),
            "runtime-1",
            &home,
        )
        .unwrap();

        for tool in DENIED_TOOLS {
            let denied = args
                .windows(2)
                .any(|pair| pair[0] == "--deny-tool" && pair[1] == tool);
            assert!(denied, "{tool} was not denied: {args:?}");
        }
    }
}
