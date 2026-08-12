use tempfile::tempdir;

use super::*;
use crate::models::WorkerSpec;

#[tokio::test]
async fn template_and_capability_route_across_stable_replicas() {
    let store = test_store().await;
    register_team(&store).await;
    make_busy(&store, "dev-one").await;
    make_busy(&store, "dev-two").await;

    let first = delegate_root(&store, "engineering", Some("implementation"), "one").await;
    let second = delegate_root(&store, "engineering", Some("implementation"), "two").await;

    assert_eq!(assignee(&store, &first).await, "dev-4");
    assert_eq!(assignee(&store, &second).await, "dev-three");
    assert_eq!(store.task_status(&first).await.unwrap(), "pending");
    assert_eq!(store.task_status(&second).await.unwrap(), "pending");
}

#[tokio::test]
async fn one_claim_per_replica_buffers_when_no_compatible_replica_is_idle() {
    let store = test_store().await;
    register_team(&store).await;
    make_busy(&store, "dev-one").await;
    make_busy(&store, "dev-two").await;
    let first = delegate_root(&store, "engineering", Some("implementation"), "one").await;
    let second = delegate_root(&store, "engineering", Some("implementation"), "two").await;
    let buffered = delegate_root(&store, "engineering", Some("implementation"), "three").await;

    assert_eq!(assignee(&store, &first).await, "dev-4");
    assert_eq!(assignee(&store, &second).await, "dev-three");
    assert_eq!(assignee(&store, &buffered).await, "dev-4");
    assert_eq!(store.task_status(&buffered).await.unwrap(), "buffered");
    assert_eq!(store.claim("dev-4").await.unwrap().unwrap().id, first);
    assert_eq!(store.task_status(&buffered).await.unwrap(), "buffered");
}

#[tokio::test]
async fn replica_children_preserve_parent_dependency_ordering() {
    let store = test_store().await;
    register_team(&store).await;
    let parent = store
        .create_message("human", "lead", "root", "Coordinate.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    store
        .set_state("lead", "working", Some("root"))
        .await
        .unwrap();
    let first = store
        .delegate_current_compatible(
            "lead",
            "engineering",
            Some("implementation"),
            "one",
            "First.",
        )
        .await
        .unwrap();
    let second = store
        .delegate_current_compatible(
            "lead",
            "engineering",
            Some("implementation"),
            "two",
            "Second.",
        )
        .await
        .unwrap();
    assert_eq!(store.task_status(&parent).await.unwrap(), "waiting");

    let first_agent = assignee(&store, &first).await;
    store.claim(&first_agent).await.unwrap().unwrap();
    store.complete_current(&first_agent, "done").await.unwrap();
    assert_eq!(store.task_status(&parent).await.unwrap(), "waiting");

    let second_agent = assignee(&store, &second).await;
    store.claim(&second_agent).await.unwrap().unwrap();
    store.complete_current(&second_agent, "done").await.unwrap();
    assert_eq!(store.task_status(&parent).await.unwrap(), "pending");
}

#[tokio::test]
async fn replica_routing_rejects_conflicting_claims_instead_of_rerouting() {
    let store = test_store().await;
    register_team(&store).await;
    store
        .create_message("human", "lead", "root", "Coordinate.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    store
        .set_state("lead", "working", Some("root"))
        .await
        .unwrap();
    store
        .delegate_current_compatible(
            "lead",
            "engineering",
            Some("implementation"),
            "same",
            "First body.",
        )
        .await
        .unwrap();

    let error = store
        .delegate_current_compatible(
            "lead",
            "engineering",
            Some("implementation"),
            " SAME ",
            "Conflicting body.",
        )
        .await
        .unwrap_err();

    assert!(error.to_string().contains("conflicting delegation"));
}

#[tokio::test]
async fn same_body_with_an_incompatible_capability_is_conflicting() {
    let store = test_store().await;
    register_team(&store).await;
    store
        .configure_replica_profile(&RoleConfig {
            name: "dev-4".into(),
            agent_kind: None,
            source_agent: None,
            instance_ordinal: None,
            title: None,
            template: Some("engineering".into()),
            capabilities: vec!["implementation".into()],
            replica_eligible: true,
            description: "Engineer".into(),
            prompt: "Work.".into(),
            model: None,
            appearance: None,
        })
        .await
        .unwrap();
    store
        .create_message("human", "lead", "root", "Coordinate.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    store
        .set_state("lead", "working", Some("root"))
        .await
        .unwrap();
    store
        .delegate_current_compatible(
            "lead",
            "engineering",
            Some("implementation"),
            "same",
            "Same body.",
        )
        .await
        .unwrap();

    let error = store
        .delegate_current_compatible(
            "lead",
            "engineering",
            Some("validation"),
            "same",
            "Same body.",
        )
        .await
        .unwrap_err();

    assert!(error.to_string().contains("conflicting delegation"));
}

#[tokio::test]
async fn concurrent_conflicting_replica_claims_create_only_one_child() {
    let store = test_store().await;
    register_team(&store).await;
    let parent = store
        .create_message("human", "lead", "root", "Coordinate.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    store
        .set_state("lead", "working", Some("root"))
        .await
        .unwrap();
    let first_store = store.clone();
    let second_store = store.clone();

    let (first, second) = tokio::join!(
        first_store.delegate_current_compatible(
            "lead",
            "engineering",
            Some("implementation"),
            "same",
            "First body.",
        ),
        second_store.delegate_current_compatible(
            "lead",
            "engineering",
            Some("implementation"),
            "same",
            "Conflicting body.",
        )
    );

    assert_ne!(first.is_ok(), second.is_ok());
    let error = first.err().or_else(|| second.err()).unwrap();
    assert!(error.to_string().contains("conflicting delegation"));
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE parent_id=?")
        .bind(parent)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn legacy_named_delegation_still_buffers_on_that_exact_agent() {
    let store = test_store().await;
    register_team(&store).await;
    make_busy(&store, "dev-one").await;

    let delegated = delegate_root(&store, "dev-one", None, "legacy").await;

    assert_eq!(assignee(&store, &delegated).await, "dev-one");
    assert_eq!(store.task_status(&delegated).await.unwrap(), "buffered");
}

#[tokio::test]
async fn configured_template_wins_over_a_stale_removed_agent_identity() {
    let store = test_store().await;
    register_team(&store).await;
    store.register(&worker("engineering")).await.unwrap();

    let delegated = delegate_root(
        &store,
        "engineering",
        Some("implementation"),
        "stale identity",
    )
    .await;

    assert_eq!(assignee(&store, &delegated).await, "dev-4");
}

#[tokio::test]
async fn template_routing_rejects_missing_capabilities() {
    let store = test_store().await;
    register_team(&store).await;
    store
        .create_message("human", "lead", "root", "Coordinate.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();

    let error = store
        .delegate_current_compatible(
            "lead",
            "engineering",
            Some("database-administration"),
            "database",
            "Implement.",
        )
        .await
        .unwrap_err();

    assert!(error.to_string().contains("no eligible replica"));
}

#[tokio::test]
async fn working_replica_without_a_visible_task_still_receives_buffered_work() {
    let store = test_store().await;
    register_team(&store).await;
    for agent in ["dev-one", "dev-two", "dev-three"] {
        make_busy(&store, agent).await;
    }
    store
        .set_state("dev-4", "working", Some("transition"))
        .await
        .unwrap();

    let delegated =
        delegate_root(&store, "engineering", Some("implementation"), "transition").await;

    assert_eq!(assignee(&store, &delegated).await, "dev-4");
    assert_eq!(store.task_status(&delegated).await.unwrap(), "buffered");
}

async fn test_store() -> Store {
    let root = tempdir().unwrap().keep();
    Store::open(&root.join("harness.db")).await.unwrap()
}

async fn register_team(store: &Store) {
    for id in ["lead", "dev-one", "dev-two", "dev-three", "dev-4"] {
        store.register(&worker(id)).await.unwrap();
    }
    for id in ["dev-one", "dev-two", "dev-three", "dev-4"] {
        store
            .configure_replica_profile(&RoleConfig {
                name: id.into(),
                agent_kind: None,
                source_agent: None,
                instance_ordinal: None,
                title: None,
                template: Some("engineering".into()),
                capabilities: vec!["implementation".into(), "validation".into()],
                replica_eligible: true,
                description: "Engineer".into(),
                prompt: "Work.".into(),
                model: None,
                appearance: None,
            })
            .await
            .unwrap();
    }
}

async fn make_busy(store: &Store, agent: &str) {
    store
        .create_message("human", agent, "existing", "Existing.")
        .await
        .unwrap();
}

async fn delegate_root(
    store: &Store,
    target: &str,
    capability: Option<&str>,
    topic: &str,
) -> String {
    store
        .create_message("human", "lead", topic, "Coordinate.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    store
        .set_state("lead", "working", Some(topic))
        .await
        .unwrap();
    store
        .delegate_current_compatible("lead", target, capability, topic, "Implement.")
        .await
        .unwrap()
}

async fn assignee(store: &Store, task: &str) -> String {
    sqlx::query_scalar("SELECT assignee FROM tasks WHERE id=?")
        .bind(task)
        .fetch_one(&store.pool)
        .await
        .unwrap()
}

fn worker(id: &str) -> WorkerSpec {
    WorkerSpec {
        id: id.into(),
        role: id.into(),
        description: id.into(),
        prompt: "Work.".into(),
        model: "gpt-5.4-mini".into(),
        leader: "lead".into(),
        leader_task_limit: 3,
        idea_agents: Vec::new(),
        delegate_agents: Vec::new(),
    }
}
