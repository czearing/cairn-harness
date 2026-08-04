use std::time::Duration;

use sqlx::Acquire;
use tempfile::tempdir;

use crate::store::Store;

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
