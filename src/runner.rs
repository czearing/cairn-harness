use std::{future::Future, pin::Pin};

use crate::{
    config::CopilotConfig,
    models::{AgentOutput, RunRequest},
    protocol::parse_output,
    shell_command,
};
use anyhow::{Context, Result, bail};

pub trait AgentRunner: Send + Sync {
    fn waits_for_terminal_stop(&self) -> bool {
        false
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
        let mut cancellation = request.cancellation;
        if *cancellation.borrow() {
            bail!("agent run cancelled");
        }
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
            .kill_on_drop(true);
        command.arg("--model").arg(&request.worker.model);
        if let Some(path) = &self.config.additional_mcp_config {
            command.arg("--additional-mcp-config").arg(path);
        }
        let output = tokio::select! {
            output = command.output() => output
                .with_context(|| format!("failed to run Copilot for agent {}", request.worker.id))?,
            _ = wait_for_cancellation(&mut cancellation) => {
                bail!("agent run cancelled");
            }
        };
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

pub(crate) async fn wait_for_cancellation(cancellation: &mut tokio::sync::watch::Receiver<bool>) {
    loop {
        if *cancellation.borrow() {
            return;
        }
        if cancellation.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
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
