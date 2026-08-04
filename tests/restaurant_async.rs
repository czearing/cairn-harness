use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use anyhow::Result;
use cairn_harness::{
    config::ProjectConfig,
    models::{AgentOutput, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;

struct KitchenRunner {
    store: Store,
}

impl AgentRunner for KitchenRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let has_results = request.prompt.contains("Child results:");
            let tools = if request.worker.role == "head-chef" && !has_results {
                self.store
                    .delegate_current("head-chef", "pastry-chef", "pastry", "Create dessert.")
                    .await?;
                self.store
                    .delegate_current("head-chef", "sauce-chef", "sauce", "Create sauce.")
                    .await?;
                vec!["cairn-harness/task_delegate".into()]
            } else {
                self.store
                    .complete_current(&request.worker.id, &format!("{} result", request.worker.id))
                    .await?;
                vec!["cairn-harness/task_complete".into()]
            };
            Ok(AgentOutput {
                summary: "Kitchen work advanced.".into(),
                deliverable: None,
                tools,
                complete: true,
            })
        })
    }
}

#[tokio::test]
async fn delegation_uses_only_the_canonical_graph() {
    let temp = tempdir().unwrap();
    let config = restaurant_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(KitchenRunner {
        store: store.clone(),
    });
    let harness = Harness::new(config.clone(), store, runner);
    harness.bootstrap().await.unwrap();
    harness
        .send("human", "head-chef", "menu", "Create a menu.")
        .await
        .unwrap();
    harness
        .run_until_idle(Duration::from_millis(125))
        .await
        .unwrap();

    let transcript = harness.store().transcript().await.unwrap();
    assert_eq!(
        harness.store().completed_task_count().await.unwrap(),
        3,
        "{transcript:#?}"
    );
    assert_eq!(
        transcript
            .iter()
            .find(|turn| turn.status == "waiting")
            .unwrap()
            .output
            .summary,
        "Delegated: pastry; sauce"
    );
    assert!(!config.root.join("todos").exists());
    assert!(transcript.iter().any(|turn| {
        turn.output
            .tools
            .contains(&"cairn-harness/task_delegate".to_string())
    }));
    assert!(
        harness
            .transcript(false)
            .await
            .unwrap()
            .contains("### Tools")
    );
}

fn restaurant_config(root: &std::path::Path) -> ProjectConfig {
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let path = root.join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Kitchen","root":{},"leader":"head-chef","roles":[
        {{"name":"head-chef","description":"Lead","prompt":"Lead."}},
        {{"name":"pastry-chef","description":"Pastry","prompt":"Cook."}},
        {{"name":"sauce-chef","description":"Sauce","prompt":"Cook."}}]}}"#,
            serde_json::to_string(&workspace).unwrap()
        ),
    )
    .unwrap();
    ProjectConfig::load(&path).unwrap()
}
