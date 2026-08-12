use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use anyhow::anyhow;
use tempfile::tempdir;
use tokio::sync::oneshot;

use super::PersistentCopilotRunner;
use crate::{config::CopilotConfig, models::WorkerSpec, store::Store};

#[tokio::test]
async fn pending_startup_does_not_block_other_workers() {
    let runner = Arc::new(PersistentCopilotRunner::new(CopilotConfig::default()));
    let (a_started_tx, a_started_rx) = oneshot::channel();
    let (release_a_tx, release_a_rx) = oneshot::channel();
    let a_runner = runner.clone();
    let worker_a = worker("worker-a");
    let pending_a = tokio::spawn(async move {
        a_runner
            .ensure_with(
                PathBuf::new(),
                worker_a,
                String::new(),
                move |_, _, _, _, _jobs, ready| async move {
                    let _ = a_started_tx.send(());
                    let _ = release_a_rx.await;
                    let _ = ready.send(Ok("session-a".into()));
                    Ok(())
                },
            )
            .await
    });
    a_started_rx.await.unwrap();

    let worker_b = worker("worker-b");
    let ready_b = tokio::time::timeout(
        Duration::from_secs(1),
        runner.ensure_with(
            PathBuf::new(),
            worker_b.clone(),
            String::new(),
            |_, _, _, _, _jobs, ready| async move {
                let _ = ready.send(Ok("session-b".into()));
                Ok(())
            },
        ),
    )
    .await
    .expect("worker B startup waited for worker A")
    .unwrap();
    assert_eq!(ready_b.handle.session_id, "session-b");

    let existing_b = tokio::time::timeout(
        Duration::from_secs(1),
        runner.ensure_with(
            PathBuf::new(),
            worker_b,
            "session-b".into(),
            |_, _, _, _, _, _| async { panic!("existing worker B restarted") },
        ),
    )
    .await
    .expect("existing worker B lookup waited for worker A")
    .unwrap();
    assert_eq!(existing_b.handle.session_id, "session-b");

    let _ = release_a_tx.send(());
    assert_eq!(
        pending_a.await.unwrap().unwrap().handle.session_id,
        "session-a"
    );
}

#[tokio::test]
async fn concurrent_startup_for_one_worker_is_single_flight() {
    let runner = Arc::new(PersistentCopilotRunner::new(CopilotConfig::default()));
    let starts = Arc::new(AtomicUsize::new(0));
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let first_runner = runner.clone();
    let first_starts = starts.clone();
    let first = tokio::spawn(async move {
        first_runner
            .ensure_with(
                PathBuf::new(),
                worker("writer"),
                String::new(),
                move |_, _, _, _, _jobs, ready| async move {
                    first_starts.fetch_add(1, Ordering::SeqCst);
                    let _ = started_tx.send(());
                    let _ = release_rx.await;
                    let _ = ready.send(Ok("shared-session".into()));
                    Ok(())
                },
            )
            .await
    });
    started_rx.await.unwrap();

    let second_runner = runner.clone();
    let second_starts = starts.clone();
    let second = tokio::spawn(async move {
        second_runner
            .ensure_with(
                PathBuf::new(),
                worker("writer"),
                String::new(),
                move |_, _, _, _, _jobs, ready| async move {
                    second_starts.fetch_add(1, Ordering::SeqCst);
                    let _ = ready.send(Ok("duplicate-session".into()));
                    Ok(())
                },
            )
            .await
    });

    let _ = release_tx.send(());
    let first = first.await.unwrap().unwrap();
    let second = second.await.unwrap().unwrap();
    assert_eq!(starts.load(Ordering::SeqCst), 1);
    assert_eq!(first.handle.session_id, "shared-session");
    assert_eq!(second.handle.session_id, "shared-session");
    assert!(first.handle.jobs.same_channel(&second.handle.jobs));
}

#[tokio::test]
async fn failed_startup_is_evicted_and_can_retry() {
    let runner = PersistentCopilotRunner::new(CopilotConfig::default());
    let attempts = Arc::new(AtomicUsize::new(0));
    let first_attempts = attempts.clone();
    let error = match runner
        .ensure_with(
            PathBuf::new(),
            worker("writer"),
            String::new(),
            move |_, _, _, _, _jobs, ready| async move {
                first_attempts.fetch_add(1, Ordering::SeqCst);
                let _ = ready.send(Err(anyhow!("startup failed")));
                Ok(())
            },
        )
        .await
    {
        Ok(_) => panic!("failed startup left a ready agent"),
        Err(error) => error,
    };
    assert_eq!(error.to_string(), "startup failed");

    let second_attempts = attempts.clone();
    let ready = runner
        .ensure_with(
            PathBuf::new(),
            worker("writer"),
            String::new(),
            move |_, _, _, _, _jobs, ready| async move {
                second_attempts.fetch_add(1, Ordering::SeqCst);
                let _ = ready.send(Ok("retry-session".into()));
                Ok(())
            },
        )
        .await
        .unwrap();
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    assert_eq!(ready.handle.session_id, "retry-session");
}

#[tokio::test]
async fn cancelled_startup_caller_does_not_orphan_in_flight_entry() {
    let runner = Arc::new(PersistentCopilotRunner::new(CopilotConfig::default()));
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let first_runner = runner.clone();
    let first = tokio::spawn(async move {
        first_runner
            .ensure_with(
                PathBuf::new(),
                worker("writer"),
                String::new(),
                move |_, _, _, _, _jobs, ready| async move {
                    let _ = started_tx.send(());
                    let _ = release_rx.await;
                    let _ = ready.send(Ok("surviving-session".into()));
                    Ok(())
                },
            )
            .await
    });
    started_rx.await.unwrap();
    first.abort();
    match first.await {
        Err(error) => assert!(error.is_cancelled()),
        Ok(_) => panic!("startup caller was not cancelled"),
    }

    let waiting_runner = runner.clone();
    let waiting = tokio::spawn(async move {
        waiting_runner
            .ensure_with(
                PathBuf::new(),
                worker("writer"),
                String::new(),
                |_, _, _, _, _, _| async { panic!("cancelled caller restarted the worker") },
            )
            .await
    });
    let _ = release_tx.send(());

    let ready = tokio::time::timeout(Duration::from_secs(1), waiting)
        .await
        .expect("in-flight startup was orphaned")
        .unwrap()
        .unwrap();
    assert_eq!(ready.handle.session_id, "surviving-session");
}

#[tokio::test]
async fn exited_startup_fails_all_waiters_and_can_start_fresh() {
    let directory = tempdir().unwrap();
    let root = directory.path().to_path_buf();
    let store = Store::open(&root.join(".cairn-harness").join("harness.db"))
        .await
        .unwrap();
    let worker = worker("writer");
    store.register(&worker).await.unwrap();
    store.set_session(&worker.id, "old-session").await.unwrap();

    let runner = Arc::new(PersistentCopilotRunner::new(CopilotConfig::default()));
    let starts = Arc::new(AtomicUsize::new(0));
    let (started_tx, started_rx) = oneshot::channel();
    let (exit_tx, exit_rx) = oneshot::channel();
    let first_runner = runner.clone();
    let first_root = root.clone();
    let first_worker = worker.clone();
    let first_starts = starts.clone();
    let first = tokio::spawn(async move {
        first_runner
            .ensure_with(
                first_root,
                first_worker,
                "old-session".into(),
                move |_, _, _, _, jobs, ready| async move {
                    first_starts.fetch_add(1, Ordering::SeqCst);
                    let _startup_channels = (jobs, ready);
                    let _ = started_tx.send(());
                    let _ = exit_rx.await;
                    Err(anyhow::anyhow!("startup process exited"))
                },
            )
            .await
    });
    started_rx.await.unwrap();

    let second_runner = runner.clone();
    let second_root = root.clone();
    let second_worker = worker.clone();
    let second_starts = starts.clone();
    let second = tokio::spawn(async move {
        second_runner
            .ensure_with(
                second_root,
                second_worker,
                "old-session".into(),
                move |_, _, _, _, _, _| async move {
                    second_starts.fetch_add(1, Ordering::SeqCst);
                    panic!("concurrent waiter started a duplicate process");
                },
            )
            .await
    });

    let _ = exit_tx.send(());
    let (first, second) = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::join!(first, second)
    })
    .await
    .expect("process exit did not release concurrent waiters");
    let first_error = match first.unwrap() {
        Ok(_) => panic!("exited startup returned a ready agent"),
        Err(error) => error.to_string(),
    };
    let second_error = match second.unwrap() {
        Ok(_) => panic!("exited waiter returned a ready agent"),
        Err(error) => error.to_string(),
    };
    assert_eq!(first_error, second_error);
    assert_eq!(
        first_error,
        "Copilot ACP startup channel closed: channel closed"
    );
    assert_eq!(starts.load(Ordering::SeqCst), 1);
    assert!(!runner.agents.lock().await.contains_key(&worker.id));
    assert_eq!(store.agent(&worker.id).await.unwrap().session_id, "");

    let retry_starts = starts.clone();
    let ready = runner
        .ensure_with(
            root,
            worker,
            String::new(),
            move |_, _, _, _, mut jobs, ready| async move {
                retry_starts.fetch_add(1, Ordering::SeqCst);
                let _ = ready.send(Ok("fresh-session".into()));
                while jobs.recv().await.is_some() {}
                Ok(())
            },
        )
        .await
        .unwrap();
    assert_eq!(starts.load(Ordering::SeqCst), 2);
    assert_eq!(ready.handle.session_id, "fresh-session");
    assert_eq!(store.agent("writer").await.unwrap().session_id, "");
}

fn worker(id: &str) -> WorkerSpec {
    WorkerSpec {
        id: id.into(),
        role: id.into(),
        description: String::new(),
        prompt: String::new(),
        model: "gpt-5.4-mini".into(),
        leader: String::new(),
        leader_task_limit: 3,
        idea_agents: Vec::new(),
        delegate_agents: Vec::new(),
    }
}
