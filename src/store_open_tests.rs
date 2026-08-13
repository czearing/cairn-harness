use std::time::Duration;

use sqlx::Acquire;
use tempfile::tempdir;

use crate::store::Store;

fn wal_bytes(database: &std::path::Path) -> u64 {
    let mut name = database.as_os_str().to_os_string();
    name.push("-wal");
    std::fs::metadata(std::path::PathBuf::from(name))
        .map(|entry| entry.len())
        .unwrap_or_default()
}

#[tokio::test]
async fn existing_wal_database_reopens_while_a_reader_is_active() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("harness.db");
    let store = Store::open(&path).await.unwrap();
    let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(mode, "wal");

    let mut connection = store.pool.acquire().await.unwrap();
    let mut transaction = connection.begin().await.unwrap();
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
        .fetch_one(&mut *transaction)
        .await
        .unwrap();

    let reopened = tokio::time::timeout(Duration::from_secs(2), Store::open(&path))
        .await
        .expect("reopen timed out")
        .expect("reopen failed");
    let reopened_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&reopened.pool)
        .await
        .unwrap();
    assert_eq!(reopened_mode, "wal");
}

#[tokio::test]
async fn pool_serves_every_worker_loop_concurrently() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("harness.db");
    let store = Store::open(&path).await.unwrap();

    let mut held = Vec::new();
    for slot in 0..4 {
        let connection = tokio::time::timeout(Duration::from_secs(2), store.pool.acquire())
            .await
            .unwrap_or_else(|_| panic!("pool starved while acquiring connection {slot}"))
            .unwrap();
        held.push(connection);
    }

    let free = tokio::time::timeout(Duration::from_secs(2), store.pool.acquire())
        .await
        .expect("pool left no headroom for heartbeat and recovery queries")
        .unwrap();
    drop(free);
    drop(held);
}

#[tokio::test]
async fn every_pooled_connection_caps_the_write_ahead_log() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("harness.db");
    let store = Store::open(&path).await.unwrap();

    let mut held = Vec::new();
    for _ in 0..4 {
        let mut connection = store.pool.acquire().await.unwrap();
        let limit: i64 = sqlx::query_scalar("PRAGMA journal_size_limit")
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        assert_eq!(
            limit,
            super::WAL_BYTE_LIMIT,
            "a pooled connection left the write-ahead log unbounded"
        );
        held.push(connection);
    }
}

#[tokio::test]
async fn opening_reclaims_write_ahead_log_space_left_by_an_earlier_run() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("harness.db");
    let earlier = Store::open(&path).await.unwrap();

    let mut writer = earlier.pool.acquire().await.unwrap();
    sqlx::query("PRAGMA wal_autocheckpoint = 0")
        .execute(&mut *writer)
        .await
        .unwrap();
    sqlx::query("PRAGMA journal_size_limit = -1")
        .execute(&mut *writer)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE wal_ballast (id INTEGER PRIMARY KEY, payload TEXT)")
        .execute(&mut *writer)
        .await
        .unwrap();
    let payload = "x".repeat(64 * 1024);
    for row in 0..200 {
        sqlx::query("INSERT INTO wal_ballast (id, payload) VALUES (?, ?)")
            .bind(row)
            .bind(&payload)
            .execute(&mut *writer)
            .await
            .unwrap();
    }
    drop(writer);

    let stranded = wal_bytes(&path);
    assert!(
        stranded > super::WAL_BYTE_LIMIT as u64,
        "test failed to strand log space: only {stranded} bytes"
    );

    let reopened = Store::open(&path).await.unwrap();
    let reclaimed = wal_bytes(&path);
    assert!(
        reclaimed <= super::WAL_BYTE_LIMIT as u64,
        "opening left {reclaimed} bytes of dead log space behind, down from {stranded}"
    );

    let ballast: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM wal_ballast")
        .fetch_one(&reopened.pool)
        .await
        .unwrap();
    assert_eq!(ballast, 200, "reclaiming the log lost committed rows");
}
