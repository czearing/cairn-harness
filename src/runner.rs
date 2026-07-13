use std::{future::Future, pin::Pin};

use anyhow::{Context, Result, bail};
use tokio::process::Command;

use crate::{
    config::CopilotConfig,
    models::{AgentOutput, RunRequest},
    protocol::parse_output,
};

pub trait AgentRunner: Send + Sync {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>>;
}

pub struct CopilotRunner {
    config: CopilotConfig,
}

impl CopilotRunner {
    pub fn new(config: CopilotConfig) -> Self {
        Self { config }
    }

    async fn execute(&self, request: RunRequest) -> Result<AgentOutput> {
        let mut command = Command::new(&self.config.executable);
        command.args(&self.config.arguments);
        command
            .arg("-C")
            .arg(&request.project_root)
            .arg("--autopilot")
            .arg("--no-ask-user")
            .arg("--silent")
            .arg("--stream")
            .arg("off")
            .arg("--max-autopilot-continues")
            .arg(self.config.max_autopilot_continues.to_string())
            .arg("--max-ai-credits")
            .arg(self.config.max_ai_credits.to_string())
            .arg("--session-id")
            .arg(&request.session_id)
            .arg("-p")
            .arg(&request.prompt)
            .kill_on_drop(true);
        if self.config.allow_all_tools {
            command.arg("--allow-all-tools");
        }
        if self.config.include_mcp_instructions {
            command.arg("--allow-all-mcp-server-instructions");
        }
        for tool in &self.config.denied_tools {
            command.arg("--deny-tool").arg(tool);
        }
        if let Some(model) = &self.config.model {
            command.arg("--model").arg(model);
        }
        if let Some(path) = &self.config.additional_mcp_config {
            command.arg("--additional-mcp-config").arg(path);
        }
        let output = command
            .output()
            .await
            .with_context(|| format!("failed to run Copilot for agent {}", request.worker.id))?;
        if !output.status.success() {
            bail!(
                "Copilot failed for {}: {}",
                request.worker.id,
                String::from_utf8_lossy(&output.stderr)
            );
        }
        parse_output(&String::from_utf8_lossy(&output.stdout))
    }
}

impl AgentRunner for CopilotRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(self.execute(request))
    }
}
