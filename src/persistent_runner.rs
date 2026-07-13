use std::{collections::HashMap, future::Future, path::PathBuf, pin::Pin};

use anyhow::{Context, Result};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio::time::{Duration, timeout};

use crate::{
    acp_process,
    config::CopilotConfig,
    models::{AgentOutput, RunRequest, WorkerSpec},
    runner::AgentRunner,
};

pub struct PersistentCopilotRunner {
    config: CopilotConfig,
    agents: Mutex<HashMap<String, AgentHandle>>,
}

#[derive(Clone)]
struct AgentHandle {
    jobs: mpsc::Sender<Job>,
    session_id: String,
}

pub(crate) struct Job {
    pub prompt: String,
    pub response: oneshot::Sender<Result<AgentOutput>>,
}

impl PersistentCopilotRunner {
    pub fn new(config: CopilotConfig) -> Self {
        Self {
            config,
            agents: Mutex::new(HashMap::new()),
        }
    }

    async fn ensure(
        &self,
        root: PathBuf,
        worker: WorkerSpec,
        session_id: String,
    ) -> Result<AgentHandle> {
        let mut agents = self.agents.lock().await;
        if let Some(handle) = agents.get(&worker.id) {
            return Ok(handle.clone());
        }
        let (jobs, receiver) = mpsc::channel(8);
        let (ready_tx, ready_rx) = oneshot::channel();
        let config = self.config.clone();
        let worker_id = worker.id.clone();
        let agent_worker = worker.clone();
        tokio::spawn(async move {
            let result =
                acp_process::run(config, root, agent_worker, session_id, receiver, ready_tx).await;
            if let Err(error) = result {
                tracing::error!(agent = %worker_id, %error, "persistent Copilot agent stopped");
            }
        });
        let session_id = timeout(Duration::from_secs(60), ready_rx)
            .await
            .context("Copilot ACP startup timed out")?
            .context("Copilot ACP startup channel closed")??;
        let handle = AgentHandle { jobs, session_id };
        agents.insert(worker.id, handle.clone());
        Ok(handle)
    }

    async fn execute(&self, request: RunRequest) -> Result<AgentOutput> {
        let handle = self
            .ensure(
                request.project_root.clone(),
                request.worker.clone(),
                request.session_id.clone(),
            )
            .await?;
        if let Ok(output) = send_job(&handle, request.prompt.clone()).await {
            return Ok(output);
        }
        self.agents.lock().await.remove(&request.worker.id);
        let handle = self
            .ensure(request.project_root, request.worker, request.session_id)
            .await?;
        send_job(&handle, request.prompt).await
    }
}

async fn send_job(handle: &AgentHandle, prompt: String) -> Result<AgentOutput> {
    let (response, result) = oneshot::channel();
    handle
        .jobs
        .send(Job { prompt, response })
        .await
        .context("persistent Copilot agent stopped")?;
    timeout(Duration::from_secs(75), result)
        .await
        .context("Copilot response timed out after 75 seconds")?
        .context("persistent Copilot response channel closed")?
}

impl AgentRunner for PersistentCopilotRunner {
    fn warm<'a>(
        &'a self,
        root: PathBuf,
        worker: WorkerSpec,
        session_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>>> + Send + 'a>> {
        Box::pin(async move {
            let handle = self.ensure(root, worker, session_id).await?;
            Ok(Some(handle.session_id))
        })
    }

    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(self.execute(request))
    }
}
