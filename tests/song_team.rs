use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
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

struct SongRunner {
    active: AtomicUsize,
    maximum: AtomicUsize,
    reviews: AtomicUsize,
    sessions: Mutex<Vec<(String, String)>>,
}

impl AgentRunner for SongRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.sessions
                .lock()
                .unwrap()
                .push((request.worker.id.clone(), request.session_id.clone()));
            match request.worker.role.as_str() {
                "idea-manager" => idea_manager(&request),
                "lyricist" | "composer" | "cover-artist" => self.specialist(&request).await,
                "musician" => self.review(&request),
                role => panic!("unexpected role {role}"),
            }
        })
    }
}

impl SongRunner {
    async fn specialist(&self, request: &RunRequest) -> Result<AgentOutput> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.maximum.fetch_max(active, Ordering::SeqCst);
        assert!(request.project_root.join("shared/ep-notes.md").exists());
        tokio::time::sleep(Duration::from_millis(100)).await;
        let deliverable = format!("{} deliverable", request.worker.role);
        std::fs::write(
            request
                .project_root
                .join("shared")
                .join(format!("{}.md", request.worker.role)),
            &deliverable,
        )?;
        self.active.fetch_sub(1, Ordering::SeqCst);
        Ok(AgentOutput {
            summary: "Specialty complete.".into(),
            deliverable: Some(deliverable),
            messages: vec![OutgoingMessage {
                to: "musician".into(),
                topic: "song-review".into(),
                body: "Review this contribution.".into(),
            }],
            tools: Vec::new(),
            complete: true,
        })
    }

    fn review(&self, request: &RunRequest) -> Result<AgentOutput> {
        assert!(request.prompt.contains("Deliverable:"));
        let count = self.reviews.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(AgentOutput {
            summary: format!("Reviewed contribution {count}."),
            deliverable: (count == 3).then(|| "Approved song package one.".into()),
            messages: Vec::new(),
            tools: Vec::new(),
            complete: true,
        })
    }
}

#[tokio::test]
async fn song_work_item_delegates_parallel_specialists_and_releases() {
    let temp = tempdir().unwrap();
    let config = song_config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    let runner = Arc::new(SongRunner {
        active: AtomicUsize::new(0),
        maximum: AtomicUsize::new(0),
        reviews: AtomicUsize::new(0),
        sessions: Mutex::new(Vec::new()),
    });
    let harness = Harness::new(config.clone(), store, runner.clone());

    harness.bootstrap().await.unwrap();
    assert!(harness.replenish().await.unwrap());
    harness
        .run_steps(1, Duration::from_millis(75))
        .await
        .unwrap();
    assert_eq!(harness.ingest_work().await.unwrap(), 0);
    harness
        .run_steps(1, Duration::from_millis(75))
        .await
        .unwrap();
    harness
        .run_until_idle(Duration::from_millis(125))
        .await
        .unwrap();

    assert_eq!(runner.maximum.load(Ordering::SeqCst), 3);
    assert_eq!(harness.store().release_count().await.unwrap(), 1);
    assert_eq!(harness.store().open_work_count().await.unwrap(), 0);
    assert_eq!(
        std::fs::read_dir(config.root.join("work-items/done"))
            .unwrap()
            .count(),
        1
    );
    for name in ["lyricist", "composer", "cover-artist"] {
        assert!(
            config
                .root
                .join("shared")
                .join(format!("{name}.md"))
                .exists()
        );
    }

    let sessions = runner.sessions.lock().unwrap().clone();
    drop(harness);
    let restarted = Harness::new(
        config,
        Store::open(&temp.path().join("workspace/.cairn-harness/harness.db"))
            .await
            .unwrap(),
        runner,
    );
    restarted.bootstrap().await.unwrap();
    let states = restarted.status().await.unwrap();
    for state in states {
        let prior = sessions
            .iter()
            .find(|(agent, _)| agent == &state.agent_id)
            .map(|(_, session)| session);
        if let Some(prior) = prior {
            assert_eq!(prior, &state.session_id);
        }
    }
}

fn idea_manager(request: &RunRequest) -> Result<AgentOutput> {
    if request.prompt.contains("create-work-item") {
        let path = request.project_root.join("work-items/inbox/song-1.md");
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(path, "Create the first song for a coherent three-song EP.")?;
        return done("Created one work item.");
    }
    std::fs::create_dir_all(request.project_root.join("shared"))?;
    std::fs::write(
        request.project_root.join("shared/ep-notes.md"),
        "EP thesis: intimacy becoming courage. Keep all songs in one sonic world.",
    )?;
    for (file, to, topic) in [
        ("lyrics.todo", "lyricist", "lyrics"),
        ("composition.todo", "composer", "composition"),
        ("cover.todo", "cover-artist", "cover"),
    ] {
        std::fs::write(
            request.project_root.join("todos").join(file),
            format!(
                "to: {to}\ntopic: {topic}\n\nRead shared/ep-notes.md and complete your specialty."
            ),
        )?;
    }
    done("Documented EP direction and delegated three TODOs.")
}

fn done(summary: &str) -> Result<AgentOutput> {
    Ok(AgentOutput {
        summary: summary.into(),
        deliverable: None,
        messages: Vec::new(),
        tools: Vec::new(),
        complete: true,
    })
}

fn song_config(root: &std::path::Path) -> ProjectConfig {
    let example =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/song-team/project.json");
    let text = std::fs::read_to_string(example)
        .unwrap()
        .replace("\"root\": \".\"", "\"root\": \"workspace\"");
    let path = root.join("project.json");
    std::fs::write(&path, text).unwrap();
    let workspace = root.join("workspace");
    std::fs::create_dir_all(workspace.join("todos")).unwrap();
    ProjectConfig::load(&path).unwrap()
}
