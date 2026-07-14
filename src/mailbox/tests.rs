use tempfile::tempdir;

use super::*;
use crate::models::WorkerSpec;

#[tokio::test]
async fn claims_direct_user_messages_before_internal_backlog() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store
        .enqueue("ui-lead", "reviewer", "review", "older internal work")
        .await
        .unwrap();
    store
        .enqueue("dashboard", "reviewer", "dashboard-message", "user request")
        .await
        .unwrap();

    let message = store.claim("reviewer").await.unwrap().unwrap();

    assert_eq!(message.sender, "dashboard");
    assert_eq!(message.body, "user request");
}

#[tokio::test]
async fn reports_cancelled_claims_for_late_output_suppression() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store
        .enqueue_keyed("task:child", "lead", "builder", "work", "build")
        .await
        .unwrap();
    sqlx::query("UPDATE messages SET status='cancelled' WHERE id='task:child'")
        .execute(&store.pool)
        .await
        .unwrap();

    assert!(store.is_cancelled("task:child").await.unwrap());
}

#[tokio::test]
async fn paused_agent_does_not_claim_until_resumed() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store
        .register(&WorkerSpec {
            id: "draft".into(),
            role: "draft".into(),
            description: "Draft writer".into(),
            prompt: "Write.".into(),
        })
        .await
        .unwrap();
    store
        .enqueue("human", "draft", "work", "write")
        .await
        .unwrap();
    store.set_state("draft", "paused", None).await.unwrap();

    assert!(store.claim("draft").await.unwrap().is_none());
    store.set_state("draft", "idle", None).await.unwrap();
    assert!(store.claim("draft").await.unwrap().is_some());
}
