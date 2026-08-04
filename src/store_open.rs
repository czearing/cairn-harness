use std::{path::Path, sync::OnceLock, time::Duration};

use anyhow::{Result, ensure};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

static OPEN_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub(crate) async fn open_pool(path: &Path) -> Result<SqlitePool> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let _open = OPEN_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;

    ensure_wal(&pool).await?;
    sqlx::raw_sql(include_str!("../schema.sql"))
        .execute(&pool)
        .await?;
    crate::store_migrations::migrate(&pool).await?;
    Ok(pool)
}

async fn ensure_wal(pool: &SqlitePool) -> Result<()> {
    let current: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(pool)
        .await?;
    if current.eq_ignore_ascii_case("wal") {
        return Ok(());
    }

    let selected: String = sqlx::query_scalar("PRAGMA journal_mode = WAL")
        .fetch_one(pool)
        .await?;
    ensure!(
        selected.eq_ignore_ascii_case("wal"),
        "SQLite refused WAL journal mode and selected {selected}"
    );
    Ok(())
}

#[cfg(test)]
#[path = "store_open_tests.rs"]
mod tests;
