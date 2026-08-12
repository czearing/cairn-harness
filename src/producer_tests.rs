use std::sync::Arc;

use chrono::{Duration, TimeZone, Utc};
use tempfile::tempdir;

use crate::{
    config::ProjectConfig,
    models::{AgentOutput, RunRequest},
    orchestrator::Harness,
    runner::AgentRunner,
    store::Store,
};

struct UnusedRunner;

impl AgentRunner for UnusedRunner {
    fn run<'a>(
        &'a self,
        _request: RunRequest,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<AgentOutput>> + Send + 'a>>
    {
        Box::pin(async { unreachable!("producer store tests do not run workers") })
    }
}

#[tokio::test]
async fn failed_automatic_root_is_blocked_during_cooldown_but_distinct_work_is_allowed() {
    let (harness, store) = harness().await;
    terminal_root(&store, "failed").await;

    assert!(harness.replenish().await.unwrap());
    let generator = store.claim("producer").await.unwrap().unwrap();
    assert!(generator.body.contains("failed: repeated"));
    store
        .set_state("producer", "working", Some("create-work-item"))
        .await
        .unwrap();
    let error = store
        .create_from_generator("producer", "leader", None, "repeated", "Same body.")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("retry cooldown after failed"));
    store
        .create_message("operator", "leader", "repeated", "Same body.")
        .await
        .unwrap();
    store
        .create_from_generator("producer", "leader", None, "distinct", "Different body.")
        .await
        .unwrap();
}

#[tokio::test]
async fn cancelled_automatic_root_is_blocked_during_cooldown_but_distinct_work_is_allowed() {
    let (harness, store) = harness().await;
    terminal_root(&store, "cancelled").await;

    assert!(harness.replenish().await.unwrap());
    let generator = store.claim("producer").await.unwrap().unwrap();
    assert!(generator.body.contains("cancelled: repeated"));
    store
        .set_state("producer", "working", Some("create-work-item"))
        .await
        .unwrap();
    let error = store
        .create_from_generator("producer", "leader", None, "repeated", "Same body.")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("retry cooldown after cancelled"));
    store
        .create_from_generator("producer", "leader", None, "distinct", "Different body.")
        .await
        .unwrap();
}

#[tokio::test]
async fn equivalent_automatic_root_can_return_once_after_cooldown() {
    let (harness, store) = harness().await;
    terminal_root(&store, "failed").await;
    sqlx::query(
        "UPDATE tasks SET completed_at='2000-01-01T00:00:00Z'
         WHERE kind='root' AND source='automatic' AND status='failed'",
    )
    .execute(&store.pool)
    .await
    .unwrap();

    assert!(harness.replenish().await.unwrap());
    store.claim("producer").await.unwrap().unwrap();
    let retried = store
        .create_from_generator("producer", "leader", None, "repeated", "Same body.")
        .await
        .unwrap();
    store.complete_current("producer", "created").await.unwrap();

    assert!(!harness.replenish().await.unwrap());
    let error = store
        .create_automatic_root_once(
            "producer",
            "leader",
            "repeated",
            "Same body.",
            "duplicate-generator",
            false,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("already active"));
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM tasks WHERE id=? OR (
         kind='root' AND source='automatic' AND topic='repeated' AND body='Same body.'
         AND status IN ('pending','claimed','waiting','deferred','buffered'))",
    )
    .bind(retried)
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn cooldown_boundary_is_allowed_but_one_tick_inside_is_blocked() {
    let (_, store) = harness().await;
    store.set_producer_retry_cooldown(3600).await.unwrap();
    terminal_root(&store, "failed").await;
    let now = Utc.with_ymd_and_hms(2026, 7, 16, 12, 0, 0).unwrap();
    let boundary = now - Duration::hours(1);
    sqlx::query(
        "UPDATE tasks SET completed_at=?
         WHERE kind='root' AND source='automatic' AND status='failed'",
    )
    .bind((boundary + Duration::nanoseconds(1)).to_rfc3339())
    .execute(&store.pool)
    .await
    .unwrap();

    let inside = store
        .create_automatic_root_once_at(
            "producer",
            "leader",
            "repeated",
            "Same body.",
            "inside-generator",
            false,
            now,
        )
        .await
        .unwrap_err();
    assert!(inside.to_string().contains("retry cooldown after failed"));

    sqlx::query(
        "UPDATE tasks SET completed_at=?
         WHERE kind='root' AND source='automatic' AND status='failed'",
    )
    .bind(boundary.to_rfc3339())
    .execute(&store.pool)
    .await
    .unwrap();
    store
        .create_automatic_root_once_at(
            "producer",
            "leader",
            "repeated",
            "Same body.",
            "boundary-generator",
            false,
            now,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn concurrent_equivalent_attempts_create_one_automatic_root() {
    let (_, store) = harness().await;
    let first_store = store.clone();
    let second_store = store.clone();
    let (first, second) = tokio::join!(
        first_store.create_automatic_root_once(
            "producer",
            "leader",
            "concurrent",
            "Same body.",
            "generator-one",
            false,
        ),
        second_store.create_automatic_root_once(
            "producer",
            "leader",
            "concurrent",
            "Same body.",
            "generator-two",
            false,
        )
    );

    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    let error = first.err().or_else(|| second.err()).unwrap();
    assert!(error.to_string().contains("already active"));
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM tasks
         WHERE kind='root' AND source='automatic' AND topic='concurrent' AND body='Same body.'",
    )
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn automatic_generation_does_not_duplicate_active_operator_work() {
    let (_, store) = harness().await;
    store
        .create_message("operator", "leader", "operator-topic", "Operator body.")
        .await
        .unwrap();

    let error = store
        .create_automatic_root_once(
            "producer",
            "leader",
            "operator-topic",
            "Operator body.",
            "operator-duplicate-generator",
            false,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("already active"));
}

#[tokio::test]
async fn multiple_idea_agents_pause_independently_at_their_task_limits() {
    let directory = tempdir().unwrap();
    let root = directory.keep();
    let workspace = root.join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    let path = root.join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Ideas","root":{},"leader":"leader","idea_agents":[{{"agent":"ideas-a","task_limit":1,"prompt":"Create A."}},{{"agent":"ideas-b","task_limit":1,"prompt":"Create B."}}],"roles":[{{"name":"leader","description":"Lead","prompt":"Lead."}},{{"name":"ideas-a","description":"Ideas A","prompt":"Ideas."}},{{"name":"ideas-b","description":"Ideas B","prompt":"Ideas."}}]}}"#,
            serde_json::to_string(&workspace).unwrap()
        ),
    )
    .unwrap();
    let config = ProjectConfig::load(&path).unwrap();
    let store = Store::open(&config.database_path()).await.unwrap();
    let harness = Harness::new(config, store.clone(), Arc::new(UnusedRunner));
    harness.bootstrap().await.unwrap();

    assert!(harness.replenish().await.unwrap());
    let generator = store.claim("ideas-a").await.unwrap().unwrap();
    assert_eq!(generator.kind, "generator");
    store
        .create_from_generator("ideas-a", "leader", None, "a-one", "First A task.")
        .await
        .unwrap();
    store.complete_current("ideas-a", "created").await.unwrap();

    assert!(!harness.replenish().await.unwrap());
    assert_eq!(store.automatic_root_count_for("ideas-a").await.unwrap(), 1);
    assert_eq!(
        store.pending_generator_count_for("ideas-b").await.unwrap(),
        1
    );

    let root_task = store.claim("leader").await.unwrap().unwrap();
    store
        .finish(&root_task.id, "completed", None)
        .await
        .unwrap();
    assert!(harness.replenish().await.unwrap());
    assert_eq!(
        store.pending_generator_count_for("ideas-a").await.unwrap(),
        1
    );
}

async fn terminal_root(store: &Store, status: &str) {
    store
        .create_root(
            "producer",
            "leader",
            "repeated",
            "Same body.",
            "automatic",
            Some("old-generator"),
        )
        .await
        .unwrap();
    let root = store.claim("leader").await.unwrap().unwrap();
    store.finish(&root.id, status, Some(status)).await.unwrap();
}

async fn harness() -> (Harness, Store) {
    let directory = tempdir().unwrap();
    let root = directory.keep();
    let workspace = root.join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    let path = root.join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Cooldown","root":{},"leader":"leader","producer":"producer","producer_limit":1,"producer_retry_cooldown_seconds":3600,"roles":[{{"name":"leader","description":"Lead","prompt":"Lead."}},{{"name":"producer","description":"Produce","prompt":"Produce."}}]}}"#,
            serde_json::to_string(&workspace).unwrap()
        ),
    )
    .unwrap();
    let config = ProjectConfig::load(&path).unwrap();
    let store = Store::open(&config.database_path()).await.unwrap();
    let harness = Harness::new(config, store.clone(), Arc::new(UnusedRunner));
    harness.bootstrap().await.unwrap();
    (harness, store)
}
