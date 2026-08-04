use tempfile::tempdir;

use super::*;

#[tokio::test]
async fn a_second_watcher_cannot_take_the_slot_while_the_first_heartbeats() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();

    assert!(
        store
            .acquire_worker_instance("host:1", 60_000)
            .await
            .unwrap()
    );
    assert!(
        !store
            .acquire_worker_instance("host:2", 60_000)
            .await
            .unwrap()
    );
    assert!(store.renew_worker_instance("host:1").await.unwrap());
    assert!(
        !store
            .acquire_worker_instance("host:2", 60_000)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn the_holder_reacquires_its_own_slot_without_blocking_itself() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();

    assert!(
        store
            .acquire_worker_instance("host:1", 60_000)
            .await
            .unwrap()
    );
    assert!(
        store
            .acquire_worker_instance("host:1", 60_000)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn an_expired_lease_lets_a_replacement_watcher_start() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();

    assert!(
        store
            .acquire_worker_instance("host:1", 60_000)
            .await
            .unwrap()
    );
    assert!(store.acquire_worker_instance("host:2", 0).await.unwrap());
    assert!(!store.renew_worker_instance("host:1").await.unwrap());
}

#[tokio::test]
async fn releasing_the_slot_lets_a_restart_start_immediately() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();

    assert!(
        store
            .acquire_worker_instance("host:1", 60_000)
            .await
            .unwrap()
    );
    store.release_worker_instance("host:1").await.unwrap();
    assert!(
        store
            .acquire_worker_instance("host:2", 60_000)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn a_replaced_watcher_stops_renewing() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();

    assert!(
        store
            .acquire_worker_instance("host:1", 60_000)
            .await
            .unwrap()
    );
    assert!(store.acquire_worker_instance("host:2", 0).await.unwrap());
    assert!(!store.renew_worker_instance("host:1").await.unwrap());
    assert!(store.renew_worker_instance("host:2").await.unwrap());
}
