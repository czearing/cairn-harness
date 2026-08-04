use cairn_harness::store::Store;
use sqlx::sqlite::SqliteConnectOptions;
use tempfile::tempdir;

#[tokio::test]
async fn legacy_coordination_tables_migrate_then_disappear() {
    let temp = tempdir().unwrap();
    let file = temp.path().join("harness.db");
    let pool = sqlx::SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(&file)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE messages(
          id TEXT PRIMARY KEY,sender TEXT,recipient TEXT,topic TEXT,body TEXT,status TEXT,
          attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
         CREATE TABLE work_items(
          id TEXT PRIMARY KEY,path TEXT,content_hash TEXT,message_id TEXT,status TEXT,
          created_at TEXT,completed_at TEXT);
         CREATE TABLE dead_letters(id TEXT PRIMARY KEY,body TEXT);
         INSERT INTO dead_letters VALUES('dead-one','preserve me');
         INSERT INTO messages VALUES(
          'work-item:one','work-items','lead','work-item','Build it.','pending',0,NULL,
          '2026-01-01T00:00:00Z',NULL,NULL);
         INSERT INTO work_items VALUES(
          'one','work-items/in-progress/one.md','hash','work-item:one','in-progress',
          '2026-01-01T00:00:00Z',NULL);",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let store = Store::open(&file).await.unwrap();
    assert_eq!(store.task_count("pending").await.unwrap(), 1);
    let verify = sqlx::SqlitePool::connect_with(SqliteConnectOptions::new().filename(&file))
        .await
        .unwrap();
    let (legacy,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table'
         AND name IN ('messages','work_items','todo_files')",
    )
    .fetch_one(&verify)
    .await
    .unwrap();
    assert_eq!(legacy, 0);
    let (dead_letters,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM dead_letters WHERE id='dead-one'")
            .fetch_one(&verify)
            .await
            .unwrap();
    assert_eq!(dead_letters, 1);
}
