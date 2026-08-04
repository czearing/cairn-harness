mod common;

use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use anyhow::{Result, bail};
use cairn_harness::{
    models::{AgentOutput, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;

use common::config;

struct PostDelegationFailureRunner {
    store: Store,
}

impl AgentRunner for PostDelegationFailureRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            if request.worker.id == "pm" && !request.prompt.contains("Child results:") {
                self.store
                    .delegate_current("pm", "designer", "design", "Design it.")
                    .await?;
                bail!("empty agent output");
            }
            let result = format!("{} result", request.worker.id);
            self.store
                .complete_current(&request.worker.id, &result)
                .await?;
            Ok(AgentOutput {
                summary: "stale prior summary".into(),
                deliverable: Some("stale prior deliverable".into()),
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn committed_delegation_survives_a_post_tool_agent_error() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(PostDelegationFailureRunner {
        store: store.clone(),
    });
    let harness = Harness::new(config, store, runner);
    harness.bootstrap().await.unwrap();
    harness
        .send("human", "pm", "goal", "Create the product.")
        .await
        .unwrap();

    harness
        .run_until_idle(Duration::from_millis(100))
        .await
        .unwrap();

    assert_eq!(harness.store().completed_task_count().await.unwrap(), 2);
    assert_eq!(harness.store().open_task_count().await.unwrap(), 0);
    let transcript = harness.store().transcript().await.unwrap();
    let waiting = transcript
        .iter()
        .find(|turn| turn.status == "waiting")
        .unwrap();
    assert_eq!(waiting.output.summary, "Delegated: design");
    assert!(!waiting.output.summary.contains("empty agent output"));
    for turn in transcript.iter().filter(|turn| turn.status == "completed") {
        assert_eq!(
            turn.output.summary,
            format!("Completed: {}", turn.inbound_topic)
        );
        assert_eq!(
            turn.output.deliverable.as_deref(),
            Some(format!("{} result", turn.agent_id).as_str())
        );
    }
}
