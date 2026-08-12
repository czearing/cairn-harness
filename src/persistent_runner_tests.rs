use anyhow::anyhow;
use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tempfile::tempdir;
use tokio::sync::{Semaphore, oneshot, watch};

use super::*;
use crate::{
    config::CopilotConfig,
    models::{AgentOutput, RunRequest},
    policy::RuntimePolicy,
    runner::AgentRunner,
    worker::{WorkerContext, process},
};

struct ScriptedPersistentRunner {
    runner: PersistentCopilotRunner,
    start: StartAgent,
}

impl AgentRunner for ScriptedPersistentRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(self.runner.execute_with(request, self.start.clone()))
    }
}

#[test]
fn unusable_persistent_sessions_require_a_fresh_session() {
    assert!(requires_fresh_session(&anyhow!(
        "Copilot session error: Missing namespace for function_call"
    )));
    assert!(requires_fresh_session(&anyhow!(
        "persistent Copilot response channel closed"
    )));
    assert!(requires_fresh_session(&anyhow!(
        "persistent Copilot agent stopped"
    )));
    for _ in 0..20 {
        assert!(requires_fresh_session(&anyhow!(
            "Internal error: {{\"data\":\"Process exited with exit code: 0xffffffff\"}}"
        )));
    }
}

#[test]
fn ready_agents_are_reused_only_for_the_same_session() {
    let (jobs, _receiver) = mpsc::channel(1);
    let (stop, _stop_rx) = watch::channel(false);
    let entry = AgentEntry {
        state: watch::channel(StartupState::Ready(AgentHandle {
            jobs,
            session_id: "old-session".into(),
        }))
        .1,
        requested_session_id: "old-session".into(),
        requested_model: "gpt-5.4-mini".into(),
        hook_revision: "hook-a".into(),
        stop,
    };

    assert!(reusable_for_session(&entry, "old-session", "gpt-5.4-mini"));
    assert!(!reusable_for_session(&entry, "", "gpt-5.4-mini"));
    assert!(!reusable_for_session(
        &entry,
        "replacement-session",
        "gpt-5.4-mini"
    ));
    assert!(!reusable_for_session(&entry, "old-session", "gpt-5.5"));
    assert!(crate::persistent_runner_startup::reusable_with_hook(
        &entry,
        "old-session",
        "gpt-5.4-mini",
        "hook-a"
    ));
    assert!(!crate::persistent_runner_startup::reusable_with_hook(
        &entry,
        "old-session",
        "gpt-5.4-mini",
        "hook-b"
    ));
}

#[tokio::test]
async fn turn_cancellation_does_not_cancel_the_next_persistent_job() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}}]}}"#,
            serde_json::to_string(&root).unwrap()
        ),
    )
    .unwrap();
    let config = crate::config::ProjectConfig::load(&path).unwrap();
    let store = crate::store::Store::open(&config.database_path())
        .await
        .unwrap();
    let worker = config.workers().remove(0);
    store.register(&worker).await.unwrap();
    let runner = PersistentCopilotRunner::new(CopilotConfig::default());
    let (events, mut event_rx) = mpsc::unbounded_channel();
    let ready = runner
        .ensure_with(
            root,
            worker.clone(),
            String::new(),
            move |_, _, _, _, mut jobs, ready| async move {
                let _ = ready.send(Ok("shared-session".into()));
                let mut turn = 0;
                while let Some(mut job) = jobs.recv().await {
                    turn += 1;
                    if turn == 1 {
                        let _ = events.send("started");
                        wait_for_cancellation(&mut job.cancellation).await;
                        let _ = events.send("cancelled");
                        let _ = job.response.send(Err(anyhow!("agent run cancelled")));
                    } else {
                        let _ = job.response.send(Ok(AgentOutput {
                            summary: "next turn completed".into(),
                            deliverable: None,
                            tools: Vec::new(),
                            complete: true,
                        }));
                    }
                }
                Ok(())
            },
        )
        .await
        .unwrap();
    let (cancel, cancellation) = watch::channel(false);
    let first_handle = ready.handle.clone();
    let first =
        tokio::spawn(async move { send_job(&first_handle, "first".into(), cancellation).await });
    assert_eq!(event_rx.recv().await, Some("started"));
    cancel.send_replace(true);
    assert_eq!(event_rx.recv().await, Some("cancelled"));
    assert!(
        first
            .await
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("cancelled")
    );

    let output = send_job(&ready.handle, "second".into(), watch::channel(false).1)
        .await
        .unwrap();
    assert_eq!(output.summary, "next turn completed");
    runner.evict(&worker.id, &ready.entry).await;
}

#[test]
fn cancellation_drain_errors_are_not_reusable_cancellations() {
    assert!(cleanly_cancelled(&Err(anyhow!("agent run cancelled"))));
    assert!(!cleanly_cancelled(&Err(anyhow!(
        "persistent Copilot cancellation drain failed"
    ))));
}

#[tokio::test]
async fn replaced_pending_startup_cannot_publish_a_stale_handle() {
    let (old_state, old_state_rx) = watch::channel(StartupState::Pending);
    let (old_stop, _old_stop_rx) = watch::channel(false);
    let old_entry = Arc::new(AgentEntry {
        state: old_state_rx.clone(),
        requested_session_id: "old-session".into(),
        requested_model: "gpt-5.4-mini".into(),
        hook_revision: "hook-a".into(),
        stop: old_stop,
    });
    let (_new_state, new_state_rx) = watch::channel(StartupState::Pending);
    let (new_stop, _new_stop_rx) = watch::channel(false);
    let new_entry = Arc::new(AgentEntry {
        state: new_state_rx,
        requested_session_id: String::new(),
        requested_model: "gpt-5.4-mini".into(),
        hook_revision: "hook-b".into(),
        stop: new_stop,
    });
    let agents = Mutex::new(HashMap::from([("writer".into(), new_entry)]));
    let (jobs, _receiver) = mpsc::channel(1);

    publish_ready_if_current(
        &agents,
        "writer",
        &old_entry,
        &old_state,
        AgentHandle {
            jobs,
            session_id: "old-session".into(),
        },
    )
    .await;

    assert!(matches!(
        old_state_rx.borrow().clone(),
        StartupState::Failed(error) if error == "persistent Copilot startup was replaced"
    ));
}

#[tokio::test]
async fn replacement_sessions_are_persisted() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}}]}}"#,
            serde_json::to_string(&root).unwrap()
        ),
    )
    .unwrap();
    let config = crate::config::ProjectConfig::load(&path).unwrap();
    let store = crate::store::Store::open(&config.database_path())
        .await
        .unwrap();
    let worker = config.workers().remove(0);
    store.register(&worker).await.unwrap();
    let request = RunRequest {
        project_root: root,
        worker: worker.clone(),
        session_id: String::new(),
        prompt: String::new(),
        fresh_session_prompt: None,
        cancellation: watch::channel(false).1,
    };
    let (jobs, _receiver) = mpsc::channel(1);
    let handle = AgentHandle {
        jobs,
        session_id: "replacement".into(),
    };

    persist_session(&request, &handle).await.unwrap();

    assert_eq!(
        store.agent(&worker.id).await.unwrap().session_id,
        "replacement"
    );
}

#[test]
fn replacement_session_receives_durable_context_prompt() {
    let request = RunRequest {
        project_root: PathBuf::new(),
        worker: test_worker("writer"),
        session_id: "old-session".into(),
        prompt: "current message".into(),
        fresh_session_prompt: Some("prior context\ncurrent message".into()),
        cancellation: watch::channel(false).1,
    };
    let (jobs, _receiver) = mpsc::channel(1);
    let replacement = AgentHandle {
        jobs,
        session_id: "replacement-session".into(),
    };

    assert_eq!(
        prompt_for_session(&request, &replacement),
        "prior context\ncurrent message"
    );
}

#[tokio::test]
async fn stopped_entry_cannot_clear_a_replacement_session() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}}]}}"#,
            serde_json::to_string(&root).unwrap()
        ),
    )
    .unwrap();
    let config = crate::config::ProjectConfig::load(&path).unwrap();
    let store = crate::store::Store::open(&config.database_path())
        .await
        .unwrap();
    let worker = config.workers().remove(0);
    store.register(&worker).await.unwrap();
    store
        .set_session(&worker.id, "replacement-session")
        .await
        .unwrap();

    clear_stopped_session(&root, &worker.id, "old-session")
        .await
        .unwrap();

    assert_eq!(
        store.agent(&worker.id).await.unwrap().session_id,
        "replacement-session"
    );
}

#[tokio::test]
async fn stopped_agents_clear_sessions_and_restart_without_a_stale_load() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}}]}}"#,
            serde_json::to_string(&root).unwrap()
        ),
    )
    .unwrap();
    let config = crate::config::ProjectConfig::load(&path).unwrap();
    let store = crate::store::Store::open(&config.database_path())
        .await
        .unwrap();
    let worker = config.workers().remove(0);
    store.register(&worker).await.unwrap();
    store.set_session(&worker.id, "replacement").await.unwrap();
    let runner = PersistentCopilotRunner::new(CopilotConfig::default());
    let starts = Arc::new(AtomicUsize::new(0));
    let (release_tx, release_rx) = oneshot::channel();
    let first_starts = starts.clone();
    runner
        .ensure_with(
            root.clone(),
            worker.clone(),
            "stale".into(),
            move |_, _, _, _, _jobs, ready| async move {
                first_starts.fetch_add(1, Ordering::SeqCst);
                let _ = ready.send(Ok("replacement".into()));
                let _ = release_rx.await;
                Ok(())
            },
        )
        .await
        .unwrap();
    let _ = release_tx.send(());
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let session_cleared = store.agent(&worker.id).await.unwrap().session_id.is_empty();
            let entry_evicted = !runner.agents.lock().await.contains_key(&worker.id);
            if session_cleared && entry_evicted {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("stopped agent did not clear its session");
    assert!(store.agent(&worker.id).await.unwrap().session_id.is_empty());
    assert!(!runner.agents.lock().await.contains_key(&worker.id));

    let second_starts = starts.clone();
    runner
        .ensure_with(
            root,
            worker,
            String::new(),
            move |_, _, _, session_id, _jobs, ready| async move {
                second_starts.fetch_add(1, Ordering::SeqCst);
                assert!(session_id.is_empty());
                let _ = ready.send(Ok("fresh".into()));
                Ok(())
            },
        )
        .await
        .unwrap();
    assert_eq!(starts.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn cleared_durable_session_evicts_cached_handle_without_restoring_old_id() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}}]}}"#,
            serde_json::to_string(&root).unwrap()
        ),
    )
    .unwrap();
    let config = crate::config::ProjectConfig::load(&path).unwrap();
    let store = crate::store::Store::open(&config.database_path())
        .await
        .unwrap();
    let worker = config.workers().remove(0);
    store.register(&worker).await.unwrap();
    store.set_session(&worker.id, "old-session").await.unwrap();
    let runner = PersistentCopilotRunner::new(CopilotConfig::default());
    let starts = Arc::new(AtomicUsize::new(0));
    let (old_stopped_tx, old_stopped_rx) = oneshot::channel();

    let old_starts = starts.clone();
    let old = runner
        .ensure_with(
            root.clone(),
            worker.clone(),
            "old-session".into(),
            move |_, _, _, requested, mut jobs, ready| async move {
                old_starts.fetch_add(1, Ordering::SeqCst);
                assert_eq!(requested, "old-session");
                let _ = ready.send(Ok("old-session".into()));
                while jobs.recv().await.is_some() {}
                let _ = old_stopped_tx.send(());
                Ok(())
            },
        )
        .await
        .unwrap();
    drop(old);

    store.set_session(&worker.id, "").await.unwrap();
    let fresh_starts = starts.clone();
    let fresh = runner
        .ensure_with(
            root.clone(),
            worker.clone(),
            String::new(),
            move |_, _, _, requested, mut jobs, ready| async move {
                fresh_starts.fetch_add(1, Ordering::SeqCst);
                assert!(requested.is_empty());
                let _ = ready.send(Ok("fresh-session".into()));
                while let Some(job) = jobs.recv().await {
                    assert_eq!(job.prompt, "next task");
                    let _ = job.response.send(Ok(AgentOutput {
                        summary: "fresh result".into(),
                        deliverable: None,
                        tools: Vec::new(),
                        complete: true,
                    }));
                }
                Ok(())
            },
        )
        .await
        .unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(1), old_stopped_rx)
        .await
        .expect("stale cached session was not stopped");

    let request = RunRequest {
        project_root: root,
        worker: worker.clone(),
        session_id: String::new(),
        prompt: "next task".into(),
        fresh_session_prompt: None,
        cancellation: watch::channel(false).1,
    };
    persist_session(&request, &fresh.handle).await.unwrap();
    let output = send_job(
        &fresh.handle,
        request.prompt.clone(),
        request.cancellation.clone(),
    )
    .await
    .unwrap();
    tokio::task::yield_now().await;

    assert_eq!(starts.load(Ordering::SeqCst), 2);
    assert_eq!(output.summary, "fresh result");
    assert_eq!(
        store.agent(&worker.id).await.unwrap().session_id,
        "fresh-session"
    );
}

#[tokio::test]
async fn same_claim_recovers_from_empty_output_and_startup_exit_without_failure_turns() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        format!(
            r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}}]}}"#,
            serde_json::to_string(&root).unwrap()
        ),
    )
    .unwrap();
    let config = crate::config::ProjectConfig::load(&path).unwrap();
    let worker = config.workers().remove(0);
    let store = crate::store::Store::open(&config.database_path())
        .await
        .unwrap();
    store.register(&worker).await.unwrap();
    store.set_session(&worker.id, "old-session").await.unwrap();
    let task_id = store
        .create_message(
            "human",
            &worker.id,
            "startup-recovery",
            "preserve this exact claimed task",
        )
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO task_context(id,task_id,creator,topic,body,created_at)
         VALUES('context-marker',?,'human','context','preserve-context-marker',?)",
    )
    .bind(&task_id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&store.pool)
    .await
    .unwrap();
    let task = store.claim(&worker.id).await.unwrap().unwrap();

    let starts = Arc::new(AtomicUsize::new(0));
    let observations = Arc::new(StdMutex::new(Vec::new()));
    let start: StartAgent = {
        let starts = starts.clone();
        let observations = observations.clone();
        let task_id = task_id.clone();
        Arc::new(move |_, root, worker, requested_session, mut jobs, ready| {
            let attempt = starts.fetch_add(1, Ordering::SeqCst);
            let observations = observations.clone();
            let task_id = task_id.clone();
            Box::pin(async move {
                observations
                    .lock()
                    .unwrap()
                    .push((attempt, requested_session.clone(), None));
                if attempt == 1 {
                    return Err(anyhow!("startup process exited"));
                }
                let session = match attempt {
                    0 => "old-session",
                    2 => "replacement-session",
                    3 => "recovered-session",
                    _ => panic!("unexpected persistent recovery attempt {attempt}"),
                };
                let _ = ready.send(Ok(session.into()));
                let job = jobs.recv().await.expect("recovery attempt had no job");
                let attempt_store =
                    crate::store::Store::open(&root.join(".cairn-harness").join("harness.db"))
                        .await?;
                assert!(attempt_store.is_current_claim(&task_id, &worker.id).await?);
                let state = attempt_store.agent(&worker.id).await?;
                assert_eq!(state.status, "working");
                assert_eq!(state.current_topic.as_deref(), Some("startup-recovery"));
                assert!(job.prompt.contains("preserve this exact claimed task"));
                assert!(job.prompt.contains("preserve-context-marker"));
                observations.lock().unwrap().last_mut().unwrap().2 = Some(job.prompt.clone());
                let response = if attempt == 3 {
                    attempt_store
                        .complete_current(&worker.id, "same task recovered")
                        .await?;
                    Ok(AgentOutput {
                        summary: "same task recovered".into(),
                        deliverable: None,
                        tools: Vec::new(),
                        complete: true,
                    })
                } else {
                    Err(anyhow!("empty agent output"))
                };
                let _ = job.response.send(response);
                std::future::pending::<()>().await;
                #[allow(unreachable_code)]
                Ok(())
            })
        })
    };
    let runner = Arc::new(ScriptedPersistentRunner {
        runner: PersistentCopilotRunner::new(CopilotConfig::default()),
        start,
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker: worker.clone(),
        store: store.clone(),
        runner,
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(1)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 1,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 25,
        },
        shutdown,
    };

    process(&ctx, task).await.unwrap();

    assert_eq!(starts.load(Ordering::SeqCst), 4);
    {
        let observations = observations.lock().unwrap();
        assert_eq!(
            observations
                .iter()
                .map(|(_, session, _)| session.as_str())
                .collect::<Vec<_>>(),
            vec!["old-session", "", "", ""]
        );
        let prompts: Vec<_> = observations
            .iter()
            .filter_map(|(_, _, prompt)| prompt.as_deref())
            .collect();
        assert_eq!(prompts.len(), 3);
        assert!(prompts.windows(2).all(|pair| pair[0] == pair[1]));
    }
    let outcome: (String, Option<String>, Option<String>, i64) =
        sqlx::query_as("SELECT status,result,error,attempts FROM tasks WHERE id=?")
            .bind(&task_id)
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(
        outcome,
        (
            "completed".into(),
            Some("same task recovered".into()),
            None,
            1
        )
    );
    let turns = store.transcript().await.unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].status, "completed");
    assert_eq!(turns[0].session_id, "recovered-session");
    let state = store.agent(&worker.id).await.unwrap();
    assert_eq!(state.session_id, "recovered-session");
    assert_eq!(state.status, "idle");
    assert_eq!(state.current_topic, None);
}

#[tokio::test]
async fn unrelated_persistent_job_errors_propagate_without_retry() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let worker = test_worker("writer");
    let store = crate::store::Store::open(&root.join(".cairn-harness").join("harness.db"))
        .await
        .unwrap();
    store.register(&worker).await.unwrap();
    store.set_session(&worker.id, "same-session").await.unwrap();
    let starts = Arc::new(AtomicUsize::new(0));
    let start: StartAgent = {
        let starts = starts.clone();
        Arc::new(move |_, _, _, session_id, mut jobs, ready| {
            starts.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                let _ = ready.send(Ok(session_id));
                let job = jobs.recv().await.unwrap();
                let _ = job
                    .response
                    .send(Err(anyhow!("permission broker exploded")));
                std::future::pending::<()>().await;
                #[allow(unreachable_code)]
                Ok(())
            })
        })
    };
    let runner = PersistentCopilotRunner::new(CopilotConfig::default());
    let error = runner
        .execute_with(
            RunRequest {
                project_root: root,
                worker,
                session_id: "same-session".into(),
                prompt: "same task".into(),
                fresh_session_prompt: None,
                cancellation: watch::channel(false).1,
            },
            start,
        )
        .await
        .unwrap_err();

    assert_eq!(error.to_string(), "permission broker exploded");
    assert_eq!(starts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn startup_cleanup_database_errors_propagate_without_retry() {
    let temp = tempdir().unwrap();
    let blocked_root = temp.path().join("not-a-directory");
    std::fs::write(&blocked_root, "blocked").unwrap();
    let starts = Arc::new(AtomicUsize::new(0));
    let start: StartAgent = {
        let starts = starts.clone();
        Arc::new(move |_, _, _, _, jobs, ready| {
            starts.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                let _startup_channels = (jobs, ready);
                Err(anyhow!("startup process exited"))
            })
        })
    };
    let runner = PersistentCopilotRunner::new(CopilotConfig::default());
    let error = runner
        .execute_with(
            RunRequest {
                project_root: blocked_root,
                worker: test_worker("writer"),
                session_id: "stale-session".into(),
                prompt: "same task".into(),
                fresh_session_prompt: None,
                cancellation: watch::channel(false).1,
            },
            start,
        )
        .await
        .unwrap_err();

    assert!(
        error
            .to_string()
            .starts_with("could not clear failed Copilot startup session for writer:")
    );
    assert_eq!(starts.load(Ordering::SeqCst), 1);
}

fn test_worker(id: &str) -> WorkerSpec {
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
