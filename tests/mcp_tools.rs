mod common;

use cairn_harness::{
    mcp_server::{invoke, invoke_with_producer},
    store::Store,
};
use serde_json::json;
use tempfile::tempdir;

use common::config;

#[tokio::test]
async fn mcp_tool_commits_one_idempotent_delegation() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }

    store
        .create_message("human", "pm", "goal", "Build.")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();
    let arguments = json!({"to":"designer","topic":"design","body":"Design it."});

    let first = invoke(&store, "pm", "pm", "task_delegate", &arguments)
        .await
        .unwrap();
    let second = invoke(&store, "pm", "pm", "task_delegate", &arguments)
        .await
        .unwrap();

    assert_eq!(
        first["structuredContent"]["taskId"],
        second["structuredContent"]["taskId"]
    );
    assert_eq!(store.task_count("pending").await.unwrap(), 1);

    store.claim("designer").await.unwrap().unwrap();
    let error = invoke(&store, "designer", "pm", "task_delegate", &arguments)
        .await
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("only available to the project leader")
    );
}

#[tokio::test]
async fn delegation_buffers_a_busy_assignee() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }

    store
        .create_message("human", "pm", "goal", "Build.")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();
    store
        .set_state("pm", "working", Some("goal"))
        .await
        .unwrap();
    invoke(
        &store,
        "pm",
        "pm",
        "task_delegate",
        &json!({"to":"designer","topic":"design","body":"Design it."}),
    )
    .await
    .unwrap();

    let second = invoke(
        &store,
        "pm",
        "pm",
        "task_delegate",
        &json!({"to":"designer","topic":"review","body":"Review it."}),
    )
    .await
    .unwrap();

    let second_id = second["structuredContent"]["taskId"].as_str().unwrap();
    assert_eq!(store.task_count("pending").await.unwrap(), 1);
    assert_eq!(store.task_count("buffered").await.unwrap(), 1);
    assert_eq!(store.task_status(second_id).await.unwrap(), "buffered");
}

#[tokio::test]
async fn delegation_rejects_the_work_producer() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }
    store
        .create_message("human", "pm", "goal", "Build.")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();

    let error = invoke_with_producer(
        &store,
        "pm",
        "pm",
        "designer",
        "task_delegate",
        &json!({"to":"designer","topic":"design","body":"Design it."}),
    )
    .await
    .unwrap_err();

    assert!(
        error
            .to_string()
            .contains("idea agents cannot receive delegated tasks")
    );
    assert_eq!(store.task_count("pending").await.unwrap(), 0);
}

#[tokio::test]
async fn mcp_message_send_is_durable_and_idempotent() {
    let temp = tempdir().unwrap();
    let config = config(temp.path());
    let store = Store::open(&config.database_path()).await.unwrap();
    for worker in config.workers() {
        store.register(&worker).await.unwrap();
    }
    store
        .create_message("human", "pm", "goal", "Coordinate the review.")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();

    let arguments = json!({"to":"designer","topic":"review","body":"Please review the contract."});
    let first = invoke(&store, "pm", "pm", "message_send", &arguments)
        .await
        .unwrap();
    let second = invoke(&store, "pm", "pm", "message_send", &arguments)
        .await
        .unwrap();
    let revised = invoke(
        &store,
        "pm",
        "pm",
        "message_send",
        &json!({"to":"designer","topic":"updated review","body":"Use the revised contract."}),
    )
    .await
    .unwrap();

    assert_eq!(
        first["structuredContent"]["taskId"],
        second["structuredContent"]["taskId"]
    );
    assert_ne!(
        first["structuredContent"]["taskId"],
        revised["structuredContent"]["taskId"]
    );
    assert_eq!(store.task_count("pending").await.unwrap(), 1);
    let message = store.claim("designer").await.unwrap().unwrap();
    assert_eq!(message.kind, "message");
    assert_eq!(message.creator, "pm");
    assert_eq!(message.body, "Please review the contract.");
    assert!(
        store
            .runtime_context(&message, "pm")
            .await
            .unwrap()
            .contains("Use the revised contract.")
    );

    store
        .complete_current("pm", "First coordination finished.")
        .await
        .unwrap();
    store
        .create_message("human", "pm", "goal", "Coordinate another review.")
        .await
        .unwrap();
    store.claim("pm").await.unwrap().unwrap();
    let later = invoke(&store, "pm", "pm", "message_send", &arguments)
        .await
        .unwrap();
    assert_ne!(
        first["structuredContent"]["taskId"],
        later["structuredContent"]["taskId"]
    );
}
