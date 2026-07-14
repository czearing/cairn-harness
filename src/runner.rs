use std::{future::Future, path::PathBuf, pin::Pin};

use crate::{
    config::CopilotConfig,
    models::{AgentOutput, RunRequest, WorkerSpec},
    protocol::parse_output,
    shell_command,
};
use anyhow::{Context, Result, bail};

pub trait AgentRunner: Send + Sync {
    fn warm<'a>(
        &'a self,
        _project_root: PathBuf,
        _worker: WorkerSpec,
        _session_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>>> + Send + 'a>> {
        Box::pin(async { Ok(None) })
    }

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
        let mut command = shell_command::new(&self.config.executable);
        command.args(&self.config.arguments);
        command
            .arg("-p")
            .arg(&request.prompt)
            .arg("-s")
            .arg("--no-color")
            .arg("-C")
            .arg(&request.project_root)
            .arg("--stream")
            .arg("off")
            .arg("--session-id")
            .arg(&request.session_id)
            .arg("--allow-all-tools")
            .kill_on_drop(true);
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
