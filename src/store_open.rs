use std::{path::Path, sync::OnceLock, time::Duration};

use anyhow::{Result, ensure};
use sqlx::{
    Connection, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

static OPEN_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

/// Ceiling for the write-ahead log file, in bytes.
///
/// SQLite checkpoints the log automatically once it passes a thousand pages,
/// which is four megabytes at the page size this database uses. Leaving twice
/// that much headroom keeps a routine checkpoint from truncating the file on
/// every pass while still bounding what a long run can accumulate.
const WAL_BYTE_LIMIT: i64 = 8 * 1024 * 1024;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

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
        .busy_timeout(BUSY_TIMEOUT)
        .pragma("journal_size_limit", WAL_BYTE_LIMIT.to_string());
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;

    ensure_wal(&pool).await?;
    reclaim_wal(&pool).await;
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

/// Gives back write-ahead log space that earlier runs left behind.
///
/// A checkpoint copies the log's frames into the database but leaves the file
/// itself at its high water mark, and SQLite only resets that mark once the
/// last connection to the database goes away. A harness that stays up for days
/// therefore holds onto every byte the busiest moment of the run needed: this
/// database was found carrying ninety megabytes of log against ten megabytes of
/// data, all of it already checkpointed. Startup is the one moment the harness
/// is normally alone with the file, so it is the moment worth spending on a
/// truncating checkpoint.
///
/// Nothing here is allowed to hold up the open. Dropping the busy timeout to
/// zero means a database another process is still reading refuses the
/// checkpoint immediately rather than stalling for it, and a refusal is fine:
/// the log stays bounded by `journal_size_limit` regardless, and the next
/// startup gets another chance to reclaim it. The connection is detached and
/// closed rather than returned, so the pool never hands out the impatient busy
/// timeout this needs.
async fn reclaim_wal(pool: &SqlitePool) {
    let Ok(connection) = pool.acquire().await else {
        return;
    };
    let mut connection = connection.detach();
    if sqlx::query("PRAGMA busy_timeout = 0")
        .execute(&mut connection)
        .await
        .is_ok()
    {
        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&mut connection)
            .await;
    }
    let _ = connection.close().await;
}

#[cfg(test)]
#[path = "store_open_tests.rs"]
mod tests;
