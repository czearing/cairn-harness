use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use anyhow::Result;
use cairn_harness::{
    config::ProjectConfig,
    models::{AgentOutput, OutgoingMessage, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};
use tempfile::tempdir;

struct KitchenRunner {
    active: AtomicUsize,
    maximum: AtomicUsize,
}

impl AgentRunner for KitchenRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            match request.worker.role.as_str() {
                "head-chef" => plan(&request.project_root),
                "pastry-chef" | "sauce-chef" => self.specialist(&request).await,
                "recipe-tester" => review(&request),
                role => panic!("unexpected role {role}"),
            }
        })
    }
}

impl KitchenRunner {
    async fn specialist(&self, request: &RunRequest) -> Result<AgentOutput> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.maximum.fetch_max(active, Ordering::SeqCst);
        assert!(request.project_root.join("docs/menu-brief.md").exists());
        tokio::time::sleep(Duration::from_millis(100)).await;
        let recipe = format!("{} recipe", request.worker.role);
        let path = request
            .project_root
            .join("docs")
            .join(format!("{}.md", request.worker.role));
        std::fs::write(path, &recipe)?;
        self.active.fetch_sub(1, Ordering::SeqCst);
        Ok(AgentOutput {
            summary: "Recipe created.".into(),
            deliverable: Some(recipe),
            messages: vec![OutgoingMessage {
                to: "recipe-tester".into(),
                topic: "review-recipe".into(),
                body: "Evaluate this recipe.".into(),
            }],
            tools: Vec::new(),
            complete: true,
        })
    }
}

#[tokio::test]
async fn leader_delegates_parallel_work_through_todos_and_docs() {
    let temp = tempdir().unwrap();
    let config = restaurant_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(KitchenRunner {
        active: AtomicUsize::new(0),
        maximum: AtomicUsize::new(0),
    });
    let harness = Harness::new(config.clone(), store, runner.clone());

    harness
        .run_steps(1, Duration::from_millis(75))
        .await
        .unwrap();
    assert!(config.root.join("todos/pastry.todo").exists());
    assert!(config.root.join("todos/sauce.todo").exists());
    assert_eq!(harness.ingest_todos().await.unwrap(), 0);
    harness
        .run_until_idle(Duration::from_millis(125))
        .await
        .unwrap();

    assert_eq!(runner.maximum.load(Ordering::SeqCst), 2);
    assert!(config.root.join("docs/pastry-chef.md").exists());
    assert!(config.root.join("docs/sauce-chef.md").exists());
    let transcript = harness.store().transcript().await.unwrap();
    assert!(
        transcript[0]
            .output
            .tools
            .contains(&"cairn-skill_search".to_string())
    );
    assert!(
        harness
            .transcript(false)
            .await
            .unwrap()
            .contains("### Tools")
    );
    assert_eq!(
        transcript
            .iter()
            .filter(|turn| turn.agent_id == "recipe-tester")
            .count(),
        2
    );
    assert!(
        transcript
            .iter()
            .filter(|turn| turn.agent_id == "recipe-tester")
            .all(|turn| turn.inbound_body.contains("Deliverable:"))
    );
}

fn plan(root: &std::path::Path) -> Result<AgentOutput> {
    std::fs::create_dir_all(root.join("docs"))?;
    std::fs::write(
        root.join("docs/menu-brief.md"),
        "Theme: coastal produce. Specialty: preserved citrus.",
    )?;
    std::fs::write(
        root.join("todos/pastry.todo"),
        "to: pastry-chef\ntopic: pastry\n\nCreate one tasting dessert.",
    )?;
    std::fs::write(
        root.join("todos/sauce.todo"),
        "to: sauce-chef\ntopic: sauce\n\nCreate one signature sauce.",
    )?;
    Ok(AgentOutput {
        summary: "Plan documented and delegated.".into(),
        deliverable: None,
        messages: vec![
            OutgoingMessage {
                to: "pastry-chef".into(),
                topic: "pastry".into(),
                body: "Create dessert.".into(),
            },
            OutgoingMessage {
                to: "sauce-chef".into(),
                topic: "sauce".into(),
                body: "Create sauce.".into(),
            },
        ],
        tools: vec!["cairn-skill_search".into()],
        complete: true,
    })
}

fn review(request: &RunRequest) -> Result<AgentOutput> {
    assert!(request.project_root.join("docs/menu-brief.md").exists());
    assert!(request.prompt.contains("Deliverable:"));
    Ok(AgentOutput {
        summary: "Recipe reviewed.".into(),
        deliverable: Some("Approved with adjustments.".into()),
        messages: Vec::new(),
        tools: Vec::new(),
        complete: true,
    })
}

fn restaurant_config(root: &std::path::Path) -> ProjectConfig {
    let example =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/restaurant/project.json");
    let text = std::fs::read_to_string(example)
        .unwrap()
        .replace("\"root\": \".\"", "\"root\": \"workspace\"");
    let path = root.join("project.json");
    std::fs::write(&path, text).unwrap();
    let workspace = root.join("workspace");
    std::fs::create_dir_all(workspace.join("todos")).unwrap();
    std::fs::write(
        workspace.join("todos/menu.todo"),
        "Create a tasting menu and 15 a la carte dishes.",
    )
    .unwrap();
    ProjectConfig::load(&path).unwrap()
}
