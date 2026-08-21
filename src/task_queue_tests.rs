use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use anyhow::{Result, anyhow};
use tempfile::{TempDir, tempdir};
use tokio::sync::{Semaphore, mpsc, oneshot, watch};

use super::*;
use crate::{
    config::{CopilotConfig, ProjectConfig, RoleConfig},
    models::{AgentOutput, RunRequest, WorkerSpec},
    orchestrator::Harness,
    policy::RuntimePolicy,
    runner::AgentRunner,
    worker::{WorkerContext, process, run as run_worker},
};

#[tokio::test]
async fn stale_claim_generation_cannot_renew_reclaimed_task() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let id = store
        .create_message("human", "agent", "work", "Run.")
        .await
        .unwrap();
    let stale = store.claim("agent").await.unwrap().unwrap();
    store.recover("9999-12-31T23:59:59Z").await.unwrap();
    let current = store.claim("agent").await.unwrap().unwrap();
    let before = claim_snapshot(&store, &id).await;

    assert_eq!(
        store.renew_claim_generation(&stale).await.unwrap(),
        ClaimMutation::Stale
    );

    assert_eq!(claim_snapshot(&store, &id).await, before);
    assert_eq!(current.claim_generation, stale.claim_generation + 2);
}

#[tokio::test]
async fn chat_message_is_claimed_before_the_turn_it_preempted() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let running = store
        .create_message(
            "dashboard",
            "agent",
            "dashboard-message",
            "Long first message.",
        )
        .await
        .unwrap();
    assert_eq!(store.claim("agent").await.unwrap().unwrap().id, running);
    let interrupting = store
        .create_message(
            "dashboard",
            "agent",
            "dashboard-message",
            "Stop and answer this.",
        )
        .await
        .unwrap();
    preempt_for_operator(&store, &running).await;

    // Without the operator-priority ordering arm the released turn wins on created_at and the
    // operator waits out the very turn they just interrupted.
    assert_eq!(
        store.claim("agent").await.unwrap().unwrap().id,
        interrupting
    );
}

#[tokio::test]
async fn a_preempted_turn_resumes_once_the_operator_message_is_taken() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let running = store
        .create_message(
            "dashboard",
            "agent",
            "dashboard-message",
            "Long first message.",
        )
        .await
        .unwrap();
    store.claim("agent").await.unwrap().unwrap();
    let interrupting = store
        .create_message(
            "dashboard",
            "agent",
            "dashboard-message",
            "Stop and answer this.",
        )
        .await
        .unwrap();
    preempt_for_operator(&store, &running).await;

    let taken = store.claim("agent").await.unwrap().unwrap();
    assert_eq!(taken.id, interrupting);
    store.finish(&taken.id, "completed", None).await.unwrap();

    // The yield is self-limiting: nothing is starved once the operator has been answered.
    assert_eq!(store.claim("agent").await.unwrap().unwrap().id, running);
}

#[tokio::test]
async fn preemption_ordering_does_not_reorder_ordinary_queued_messages() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let first = store
        .create_message("dashboard", "agent", "dashboard-message", "First.")
        .await
        .unwrap();
    let second = store
        .create_message("dashboard", "agent", "dashboard-message", "Second.")
        .await
        .unwrap();

    // No preemption happened, so plain arrival order must still govern.
    assert_eq!(store.claim("agent").await.unwrap().unwrap().id, first);
    assert_eq!(store.claim("agent").await.unwrap().unwrap().id, second);
}

/// Reproduces exactly what the dashboard does when chat arrives mid-turn: attach an
/// operator-priority note to the running turn, then release that turn back to pending.
async fn preempt_for_operator(store: &Store, running: &str) {
    sqlx::query(
        "INSERT INTO task_context(id,task_id,creator,topic,body,created_at)
         VALUES(?,?,'dashboard','operator-priority','An operator is waiting in chat.',?)",
    )
    .bind(format!("operator-priority:{running}"))
    .bind(running)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&store.pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE tasks SET status='pending',claimed_at=NULL,attempts=attempts-1,
         claim_generation=claim_generation+1
         WHERE id=? AND status='claimed' AND attempts>0",
    )
    .bind(running)
    .execute(&store.pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn runtime_recovery_requeues_claims_that_expire_after_bootstrap() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("worker")).await.unwrap();
    let id = store
        .create_message("human", "worker", "work", "Run.")
        .await
        .unwrap();
    store.claim("worker").await.unwrap().unwrap();
    let harness = Harness::with_policy(
        project_config(root.path().to_path_buf()),
        store.clone(),
        Arc::new(FailingRunner {
            calls: AtomicUsize::new(0),
        }),
        RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 1,
            max_attempts: 3,
            claim_lease_ms: 5,
            poll_interval_ms: 5,
        },
    );

    tokio::time::sleep(Duration::from_millis(10)).await;

    assert_eq!(harness.recover_stale_claims().await.unwrap(), 1);
    assert_eq!(store.task_status(&id).await.unwrap(), "pending");
}

#[tokio::test]
async fn stale_claim_generation_cannot_wait_or_refund_attempt() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let id = store
        .create_message("human", "agent", "work", "Run.")
        .await
        .unwrap();
    let stale = store.claim("agent").await.unwrap().unwrap();
    store.recover("9999-12-31T23:59:59Z").await.unwrap();
    let current = store.claim("agent").await.unwrap().unwrap();

    assert_eq!(
        store.wait_for_children_claim(&stale).await.unwrap(),
        ClaimMutation::Stale
    );

    assert_eq!(task_state(&store, &id).await.0, "claimed");
    assert_eq!(task_state(&store, &id).await.2, current.attempts);
}

#[tokio::test]
async fn stale_claim_generation_cannot_retry_or_fail_reclaimed_task() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let id = store
        .create_message("human", "agent", "work", "Run.")
        .await
        .unwrap();
    let stale = store.claim("agent").await.unwrap().unwrap();
    store.recover("9999-12-31T23:59:59Z").await.unwrap();
    let current = store.claim("agent").await.unwrap().unwrap();

    assert_eq!(
        store.retry_claim(&stale, "stale retry").await.unwrap(),
        ClaimMutation::Stale
    );
    assert_eq!(
        store
            .finish_claim(&stale, "failed", Some("stale failure"))
            .await
            .unwrap(),
        ClaimMutation::Stale
    );

    assert_eq!(
        task_outcome(&store, &id).await,
        ("claimed".into(), None, None, current.attempts)
    );
}

#[tokio::test]
async fn stale_claim_generation_cannot_complete_reclaimed_task() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let id = store
        .create_message("human", "agent", "work", "Run.")
        .await
        .unwrap();
    let stale = store.claim("agent").await.unwrap().unwrap();
    store.recover("9999-12-31T23:59:59Z").await.unwrap();
    let current = store.claim("agent").await.unwrap().unwrap();

    assert_eq!(
        store.complete_claim(&stale, "stale result").await.unwrap(),
        ClaimMutation::Stale
    );

    assert_eq!(
        task_outcome(&store, &id).await,
        ("claimed".into(), None, None, current.attempts)
    );
}

#[tokio::test]
async fn stale_worker_cleanup_cannot_clear_replacement_claim_or_idle_agent() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    let id = store
        .create_message("human", "agent", "work", "Run.")
        .await
        .unwrap();
    let stale = store.claim("agent").await.unwrap().unwrap();
    store.recover("9999-12-31T23:59:59Z").await.unwrap();
    let current = store.claim("agent").await.unwrap().unwrap();
    assert!(
        store
            .set_working_for_claim(&current)
            .await
            .unwrap()
            .applied()
    );

    assert_eq!(
        store.set_state_after_claim(&stale, "idle").await.unwrap(),
        ClaimMutation::Stale
    );
    assert_eq!(
        store.set_state_after_claim(&stale, "failed").await.unwrap(),
        ClaimMutation::Stale
    );

    assert_eq!(store.agent("agent").await.unwrap().status, "working");
    assert!(store.claim_is_current(&current).await.unwrap());
    assert_eq!(task_state(&store, &id).await.0, "claimed");
}

#[tokio::test]
async fn current_claim_generation_preserves_all_normal_transitions() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();

    let heartbeat = create_and_claim(&store, "heartbeat").await;
    assert!(
        store
            .renew_claim_generation(&heartbeat)
            .await
            .unwrap()
            .applied()
    );

    let waiting = create_and_claim(&store, "waiting").await;
    assert!(
        store
            .wait_for_children_claim(&waiting)
            .await
            .unwrap()
            .applied()
    );
    assert_eq!(task_state(&store, &waiting.id).await.0, "waiting");

    let retry = create_and_claim(&store, "retry").await;
    assert!(store.retry_claim(&retry, "retry").await.unwrap().applied());
    assert_eq!(task_state(&store, &retry.id).await.0, "pending");

    let complete = create_and_claim(&store, "complete").await;
    assert!(
        store
            .complete_claim(&complete, "done")
            .await
            .unwrap()
            .applied()
    );
    assert_eq!(task_outcome(&store, &complete.id).await.0, "completed");

    let fail = create_and_claim(&store, "fail").await;
    assert!(
        store
            .finish_claim(&fail, "failed", Some("failed"))
            .await
            .unwrap()
            .applied()
    );
    assert_eq!(task_outcome(&store, &fail.id).await.0, "failed");
}

#[tokio::test]
async fn recovery_reclaim_generation_survives_legacy_migration_and_reopen() {
    let root = tempdir().unwrap();
    let database = root.path().join("harness.db");
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&database)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE tasks (
          id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT NOT NULL,
          source TEXT NOT NULL,creator TEXT NOT NULL,assignee TEXT NOT NULL,
          topic TEXT NOT NULL,body TEXT NOT NULL,result TEXT,status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL,
          claimed_at TEXT,completed_at TEXT
        );",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
    let store = Store::open(&database).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    store
        .create_message("human", "agent", "work", "Run.")
        .await
        .unwrap();
    let first = store.claim("agent").await.unwrap().unwrap();
    assert_eq!(first.claim_generation, 1);
    store.recover("9999-12-31T23:59:59Z").await.unwrap();
    store.pool.close().await;

    let reopened = Store::open(&database).await.unwrap();
    let second = reopened.claim("agent").await.unwrap().unwrap();
    assert_eq!(second.claim_generation, 3);
}

#[tokio::test]
async fn cancellation_invalidation_preserves_buffered_promotion() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["lead", "worker"] {
        store.register(&worker(agent)).await.unwrap();
    }
    store
        .create_message("human", "lead", "first", "First root.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let first = store
        .delegate_current("lead", "worker", "first", "First child.")
        .await
        .unwrap();
    store
        .create_message("human", "lead", "second", "Second root.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let buffered = store
        .delegate_current("lead", "worker", "second", "Second child.")
        .await
        .unwrap();
    let stale = store.claim("worker").await.unwrap().unwrap();
    assert_eq!(stale.id, first);
    assert_eq!(store.task_status(&buffered).await.unwrap(), "buffered");

    sqlx::query(
        "UPDATE tasks SET status='cancelled',claimed_at=NULL,completed_at=?,
         claim_generation=claim_generation+1 WHERE id=? AND status='claimed'",
    )
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(&first)
    .execute(&store.pool)
    .await
    .unwrap();
    assert!(store.promote_buffered_for_agent("worker").await.unwrap());

    assert_eq!(
        store.complete_claim(&stale, "late").await.unwrap(),
        ClaimMutation::Stale
    );
    assert_eq!(store.task_status(&first).await.unwrap(), "cancelled");
    assert_eq!(store.task_status(&buffered).await.unwrap(), "pending");
}

#[tokio::test]
async fn root_capacity_is_unlimited_until_configured() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("lead")).await.unwrap();
    store.set_max_active_tasks(None, "lead").await.unwrap();
    for topic in ["one", "two", "three"] {
        store
            .create_root("dashboard", "lead", "work-item", topic, "manual", None)
            .await
            .unwrap();
    }

    assert_eq!(store.task_count("pending").await.unwrap(), 3);
    assert_eq!(store.task_count("backlog").await.unwrap(), 0);
}

#[tokio::test]
async fn recovery_requeues_waiting_tasks_without_open_children() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["lead", "worker"] {
        store.register(&worker(agent)).await.unwrap();
    }
    let parent = store
        .create_message("human", "lead", "root", "Lead the work.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let child = store
        .delegate_current("lead", "worker", "implementation", "Implement.")
        .await
        .unwrap();
    sqlx::query("UPDATE tasks SET status='cancelled' WHERE id=?")
        .bind(child)
        .execute(&store.pool)
        .await
        .unwrap();

    store.recover("9999-12-31T23:59:59Z").await.unwrap();

    assert_eq!(task_state(&store, &parent).await.0, "pending");
}

#[tokio::test]
async fn fail_orphaned_delegations_unblocks_a_parent_delegated_to_a_deleted_agent() {
    // Deleting an agent from the project config used to leave its row in place, so
    // resolve_delegation_target's exact-match fallback could still resolve a brand new
    // delegation onto that name, orphaning it forever since no worker polls for it and
    // leaving the delegating parent stuck in 'waiting'. fail_orphaned_delegations fails
    // any pending/buffered delegation whose assignee is no longer a live agent, so
    // recover()'s existing no-active-children rule can promote the parent in the same sweep.
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["lead", "deleted-worker"] {
        store.register(&worker(agent)).await.unwrap();
    }
    let parent = store
        .create_message("human", "lead", "root", "Lead the work.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let child = store
        .delegate_current("lead", "deleted-worker", "implementation", "Implement.")
        .await
        .unwrap();
    assert_eq!(store.task_status(&child).await.unwrap(), "pending");
    assert_eq!(task_state(&store, &parent).await.0, "waiting");

    // "deleted-worker" no longer appears in the live roster passed to fail_orphaned_delegations,
    // simulating it having been removed from the project config after the delegation was created.
    let live_agents = vec!["lead".to_string()];
    let failed = store.fail_orphaned_delegations(&live_agents).await.unwrap();
    assert_eq!(failed, 1);
    assert_eq!(store.task_status(&child).await.unwrap(), "failed");

    store.recover("9999-12-31T23:59:59Z").await.unwrap();

    assert_eq!(task_state(&store, &parent).await.0, "pending");
}

#[tokio::test]
async fn fail_orphaned_delegations_leaves_delegations_to_live_agents_untouched() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["lead", "worker"] {
        store.register(&worker(agent)).await.unwrap();
    }
    store
        .create_message("human", "lead", "root", "Lead the work.")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let child = store
        .delegate_current("lead", "worker", "implementation", "Implement.")
        .await
        .unwrap();

    let live_agents = vec!["lead".to_string(), "worker".to_string()];
    let failed = store.fail_orphaned_delegations(&live_agents).await.unwrap();

    assert_eq!(failed, 0);
    assert_eq!(store.task_status(&child).await.unwrap(), "pending");
}

#[tokio::test]
async fn delegated_work_buffers_per_agent_and_promotes_oldest_after_completion() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["lead", "worker", "peer"] {
        store.register(&worker(agent)).await.unwrap();
    }
    for topic in ["first root", "second root", "third root"] {
        store
            .create_root("dashboard", "lead", "work-item", topic, "manual", None)
            .await
            .unwrap();
    }

    store.claim("lead").await.unwrap().unwrap();
    let first = store
        .delegate_current("lead", "worker", "first", "First assignment")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let buffered = store
        .delegate_current("lead", "worker", "second", "Second assignment")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let concurrent = store
        .delegate_current("lead", "peer", "parallel", "Parallel assignment")
        .await
        .unwrap();

    assert_eq!(store.task_status(&first).await.unwrap(), "pending");
    assert_eq!(store.task_status(&buffered).await.unwrap(), "buffered");
    assert_eq!(store.task_status(&concurrent).await.unwrap(), "pending");
    assert_eq!(store.claim("worker").await.unwrap().unwrap().id, first);
    assert_eq!(store.claim("peer").await.unwrap().unwrap().id, concurrent);

    store
        .complete_current("worker", "First assignment complete")
        .await
        .unwrap();

    assert_eq!(store.task_status(&buffered).await.unwrap(), "pending");
    assert_eq!(store.claim("worker").await.unwrap().unwrap().id, buffered);
}

#[tokio::test]
async fn recovery_breaks_mutual_delegation_deadlock_between_waiting_agents() {
    // Two agents each delegate to the other while both are only "waiting" on their own prior
    // delegation (not pending/claimed/deferred). If "waiting" counted as busy, neither
    // delegation could ever become claimable and the pair would deadlock forever, since
    // nothing would ever complete to retrigger promotion.
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["a", "b"] {
        store.register(&worker(agent)).await.unwrap();
    }
    store
        .create_message("human", "a", "root-a", "Root for a.")
        .await
        .unwrap();
    store
        .create_message("human", "b", "root-b", "Root for b.")
        .await
        .unwrap();
    store.claim("a").await.unwrap().unwrap();
    store.claim("b").await.unwrap().unwrap();

    let child_of_b = store
        .delegate_current("a", "b", "a-to-b", "a asks b.")
        .await
        .unwrap();
    let child_of_a = store
        .delegate_current("b", "a", "b-to-a", "b asks a.")
        .await
        .unwrap();

    // child_of_b legitimately buffers: at the moment a delegates to b, b is still actively
    // claimed on its own root task (not yet waiting), so b is genuinely busy.
    assert_eq!(store.task_status(&child_of_b).await.unwrap(), "buffered");
    // child_of_a is created after b has already fallen back to "waiting" on child_of_b, so a
    // is free and this must be immediately claimable.
    assert_eq!(store.task_status(&child_of_a).await.unwrap(), "pending");

    store.recover("9999-12-31T23:59:59Z").await.unwrap();

    assert_eq!(
        store.task_status(&child_of_b).await.unwrap(),
        "pending",
        "b's buffered task must become claimable once b itself is only waiting, or the two \
         agents deadlock forever"
    );
    assert_eq!(
        store.task_status(&child_of_a).await.unwrap(),
        "pending",
        "a's task must remain claimable"
    );
    assert!(store.claim("a").await.unwrap().is_some());
    assert!(store.claim("b").await.unwrap().is_some());
}

#[tokio::test]
async fn promote_buffered_for_agent_ignores_a_merely_waiting_parent() {
    // A buffered delegation stranded behind a "waiting" (not pending/claimed/deferred) parent
    // task for the same assignee must still promote: "waiting" means the agent delegated its
    // own current work and is otherwise idle, so it remains free to pick up other work.
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("worker")).await.unwrap();
    sqlx::query(
        "INSERT INTO tasks(id,kind,source,creator,assignee,topic,body,status,created_at)
         VALUES('own-waiting','root','manual','human','worker','own','body','waiting',
         '2026-07-15T09:00:00Z')",
    )
    .execute(&store.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO tasks(id,kind,source,creator,assignee,topic,body,status,created_at)
         VALUES('buffered','delegation','agent','lead','worker','work','body','buffered',
         '2026-07-15T10:00:00Z')",
    )
    .execute(&store.pool)
    .await
    .unwrap();

    assert!(store.promote_buffered_for_agent("worker").await.unwrap());

    assert_eq!(store.task_status("buffered").await.unwrap(), "pending");
}

#[tokio::test]
async fn recovery_promotes_stranded_buffered_delegation() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("worker")).await.unwrap();
    sqlx::query(
        "INSERT INTO tasks(id,kind,source,creator,assignee,topic,body,status,created_at)
         VALUES('buffered','delegation','agent','lead','worker','work','body','buffered',
         '2026-07-15T10:00:00Z')",
    )
    .execute(&store.pool)
    .await
    .unwrap();

    store.recover("9999-12-31T23:59:59Z").await.unwrap();

    assert_eq!(store.task_status("buffered").await.unwrap(), "pending");
}

#[tokio::test]
async fn startup_retry_does_not_consume_an_execution_attempt() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("lead")).await.unwrap();
    let id = store
        .create_message("human", "lead", "startup", "Run.")
        .await
        .unwrap();
    let task = store.claim("lead").await.unwrap().unwrap();
    assert_eq!(task.attempts, 1);

    assert!(
        store
            .retry_unstarted_claim(&id, "persistent Copilot startup timed out")
            .await
            .unwrap()
    );

    assert_eq!(
        task_state(&store, &id).await,
        (
            "pending".into(),
            None,
            0,
            Some("persistent Copilot startup timed out".into())
        )
    );
}

#[tokio::test]
async fn root_capacity_backlogs_excess_work_and_promotes_the_oldest_task() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["lead", "principal", "idea", "worker"] {
        store.register(&worker(agent)).await.unwrap();
    }
    store.set_max_active_tasks(Some(2), "lead").await.unwrap();
    let first = store
        .create_root("dashboard", "lead", "work-item", "First", "manual", None)
        .await
        .unwrap();
    let second = store
        .create_root("dashboard", "lead", "work-item", "Second", "manual", None)
        .await
        .unwrap();
    let third = store
        .create_root("dashboard", "lead", "work-item", "Third", "manual", None)
        .await
        .unwrap();
    let automatic = store
        .create_root("idea", "lead", "idea", "Automatic", "automatic", None)
        .await
        .unwrap();
    let chat = store
        .create_message("human", "principal", "chat", "Ordinary chat")
        .await
        .unwrap();
    store
        .insert_task(
            "delegated-child",
            Some(&first),
            None,
            "delegation",
            "manual",
            "lead",
            "worker",
            "delegate",
            "Delegated child",
        )
        .await
        .unwrap();

    assert_eq!(task_state(&store, &first).await.0, "pending");
    assert_eq!(task_state(&store, &second).await.0, "pending");
    assert_eq!(task_state(&store, &third).await.0, "backlog");
    assert_eq!(task_state(&store, &automatic).await.0, "pending");
    assert_eq!(task_state(&store, &chat).await.0, "pending");
    assert!(store.claim("principal").await.unwrap().is_some());
    assert!(store.claim("lead").await.unwrap().is_some());

    let claimed = store.claim("lead").await.unwrap().unwrap();
    store.finish(&claimed.id, "completed", None).await.unwrap();

    assert_eq!(task_state(&store, &third).await.0, "pending");
    assert_eq!(store.claim("lead").await.unwrap().unwrap().id, third);
}

#[tokio::test]
async fn concurrent_root_insertion_never_exceeds_capacity() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("lead")).await.unwrap();
    store.set_max_active_tasks(Some(2), "lead").await.unwrap();

    let (one, two, three, four) = tokio::join!(
        store.create_root("dashboard", "lead", "work-item", "One", "manual", None),
        store.create_root("dashboard", "lead", "work-item", "Two", "manual", None),
        store.create_root("dashboard", "lead", "work-item", "Three", "manual", None),
        store.create_root("dashboard", "lead", "work-item", "Four", "manual", None),
    );
    one.unwrap();
    two.unwrap();
    three.unwrap();
    four.unwrap();

    assert_eq!(store.task_count("pending").await.unwrap(), 2);
    assert_eq!(store.task_count("backlog").await.unwrap(), 2);
}

#[tokio::test]
async fn configuring_capacity_rebalances_pending_roots_and_failure_releases_a_slot() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("lead")).await.unwrap();
    for topic in ["one", "two", "three"] {
        store
            .create_root("dashboard", "lead", "work-item", topic, "manual", None)
            .await
            .unwrap();
    }

    store.set_max_active_tasks(Some(2), "lead").await.unwrap();
    assert_eq!(store.task_count("pending").await.unwrap(), 2);
    assert_eq!(store.task_count("backlog").await.unwrap(), 1);

    let failed = store.claim("lead").await.unwrap().unwrap();
    store
        .finish(&failed.id, "failed", Some("failed"))
        .await
        .unwrap();

    assert_eq!(store.task_count("pending").await.unwrap(), 2);
    assert_eq!(store.task_count("backlog").await.unwrap(), 0);
}

#[tokio::test]
async fn budget_deferral_refunds_unstarted_claim_attempts() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker).await.unwrap();
    let task_id = store
        .create_message("human", &worker.id, "work", "Do work")
        .await
        .unwrap();
    let runner = Arc::new(FailingRunner::default());
    let budget = Arc::new(AtomicUsize::new(0));
    let (_shutdown, shutdown) = watch::channel(false);
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker,
        store: store.clone(),
        runner: runner.clone(),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: budget.clone(),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 1,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 50,
        },
        shutdown,
    };

    for _ in 0..2 {
        let task = store.claim(&ctx.worker.id).await.unwrap().unwrap();
        assert_eq!(task.attempts, 1);
        process(&ctx, task).await.unwrap();
        assert_eq!(
            task_state(&store, &task_id).await,
            ("deferred".into(), None, 0, None)
        );
        store.recover("9999-12-31T23:59:59Z").await.unwrap();
        assert_eq!(
            task_state(&store, &task_id).await,
            ("pending".into(), None, 0, None)
        );
    }
    assert_eq!(runner.calls.load(Ordering::SeqCst), 0);

    budget.store(1, Ordering::SeqCst);
    let task = store.claim(&ctx.worker.id).await.unwrap().unwrap();
    assert_eq!(task.attempts, 1);
    process(&ctx, task).await.unwrap();
    let state = task_state(&store, &task_id).await;
    assert_eq!((&state.0, &state.1, state.2), (&"pending".into(), &None, 1));
    assert!(state.3.unwrap().contains("injected runner failure"));
    assert_eq!(runner.calls.load(Ordering::SeqCst), 1);

    let claimed = store.claim(&ctx.worker.id).await.unwrap().unwrap();
    assert_eq!(claimed.attempts, 2);
    sqlx::query("UPDATE tasks SET status='cancelled',claimed_at=NULL WHERE id=?")
        .bind(&task_id)
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(!store.defer_unstarted_claim(&task_id).await.unwrap());
    assert_eq!(task_state(&store, &task_id).await.0, "cancelled");
    assert_eq!(task_state(&store, &task_id).await.2, 2);
}

#[tokio::test]
async fn empty_output_retry_then_success_is_not_terminal() {
    let (_root, ctx, store, task_id) = retry_lifecycle_fixture(
        vec![RetryStep::Error("empty agent output"), RetryStep::Complete],
        3,
    )
    .await;

    process_next(&ctx).await;
    assert_eq!(
        task_state(&store, &task_id).await,
        ("pending".into(), None, 1, Some("empty agent output".into()))
    );
    assert_eq!(turn_statuses(&store).await, vec!["retrying"]);
    assert_eq!(store.agent(&ctx.worker.id).await.unwrap().status, "idle");

    process_next(&ctx).await;
    assert_eq!(
        task_outcome(&store, &task_id).await,
        (
            "completed".into(),
            Some("completed after retry".into()),
            None,
            2
        )
    );
    assert_eq!(turn_statuses(&store).await, vec!["retrying", "completed"]);
}

#[tokio::test]
async fn complete_output_is_committed_by_the_host_without_a_tool_transition() {
    let (_root, ctx, store, task_id) =
        retry_lifecycle_fixture(vec![RetryStep::MissingTransition], 3).await;

    process_next(&ctx).await;
    let history = store.transcript().await.unwrap();
    assert_eq!(history[0].status, "completed");
    assert_eq!(
        history[0].output.deliverable.as_deref(),
        Some("uncommitted draft")
    );
    assert_eq!(task_outcome(&store, &task_id).await.0, "completed");
    assert_eq!(turn_statuses(&store).await, vec!["completed"]);
}

#[tokio::test]
async fn dashboard_message_root_is_completed_by_the_host() {
    let (_root, ctx, store, task_id) =
        retry_lifecycle_fixture(vec![RetryStep::MissingTransition], 1).await;
    sqlx::query("UPDATE tasks SET source='message',topic='dashboard-message' WHERE id=?")
        .bind(&task_id)
        .execute(&store.pool)
        .await
        .unwrap();

    process_next(&ctx).await;

    assert_eq!(task_outcome(&store, &task_id).await.0, "completed");
    assert_eq!(turn_statuses(&store).await, vec!["completed"]);
    assert_eq!(store.agent(&ctx.worker.id).await.unwrap().status, "idle");
}

#[tokio::test]
async fn exhausted_attempt_remains_failed_with_error_history() {
    let (_root, ctx, store, task_id) = retry_lifecycle_fixture(
        vec![
            RetryStep::Error("empty agent output"),
            RetryStep::Error("empty agent output"),
        ],
        2,
    )
    .await;

    process_next(&ctx).await;
    process_next(&ctx).await;

    assert_eq!(
        task_outcome(&store, &task_id).await,
        ("failed".into(), None, Some("empty agent output".into()), 2)
    );
    let history = store.transcript().await.unwrap();
    assert_eq!(
        history
            .iter()
            .map(|turn| turn.status.as_str())
            .collect::<Vec<_>>(),
        vec!["retrying", "failed"]
    );
    assert!(
        history
            .iter()
            .all(|turn| turn.output.summary == "empty agent output")
    );
    assert_eq!(store.agent(&ctx.worker.id).await.unwrap().status, "failed");
}

#[tokio::test]
async fn successful_retry_preserves_complete_attempt_history() {
    let (_root, ctx, store, task_id) = retry_lifecycle_fixture(
        vec![
            RetryStep::Error("empty agent output"),
            RetryStep::MissingTransition,
        ],
        3,
    )
    .await;

    process_next(&ctx).await;
    process_next(&ctx).await;

    assert_eq!(task_outcome(&store, &task_id).await.0, "completed");
    let history = store.transcript().await.unwrap();
    assert_eq!(
        history
            .iter()
            .map(|turn| turn.status.as_str())
            .collect::<Vec<_>>(),
        vec!["retrying", "completed"]
    );
    assert_eq!(history[0].output.summary, "empty agent output");
    assert_eq!(
        history[1].output.summary,
        "Produced output without committing"
    );
    assert_eq!(
        history[1].output.deliverable.as_deref(),
        Some("uncommitted draft")
    );
}

#[tokio::test]
async fn paused_agent_claim_guard_preserves_its_queue_until_resumed() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["paused", "idle"] {
        store.register(&worker(agent)).await.unwrap();
    }
    insert_task(&store, "paused-oldest", "paused", "2026-07-15T10:00:00Z").await;
    insert_task(&store, "paused-later", "paused", "2026-07-15T10:01:00Z").await;
    insert_task(&store, "idle-task", "idle", "2026-07-15T10:00:30Z").await;
    store.set_state("paused", "paused", None).await.unwrap();

    assert!(store.claim("paused").await.unwrap().is_none());
    assert_eq!(task_state(&store, "paused-oldest").await.0, "pending");
    assert_eq!(task_state(&store, "paused-later").await.0, "pending");
    assert_eq!(store.claim("idle").await.unwrap().unwrap().id, "idle-task");
    store.set_state("paused", "idle", None).await.unwrap();
    assert_eq!(
        store.claim("paused").await.unwrap().unwrap().id,
        "paused-oldest"
    );
    assert_eq!(task_state(&store, "paused-later").await.0, "pending");
    assert!(store.claim("idle").await.unwrap().is_none());
}

#[tokio::test]
async fn idle_claim_and_unchanged_producer_policy_stay_read_only() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("idle")).await.unwrap();
    let mut writer = store.pool.acquire().await.unwrap();
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *writer)
        .await
        .unwrap();

    let idle_claim = tokio::time::timeout(Duration::from_millis(250), store.claim("idle"))
        .await
        .expect("idle claim entered a blocked write")
        .unwrap();
    assert!(idle_claim.is_none());
    tokio::time::timeout(
        Duration::from_millis(250),
        store.set_producer_retry_cooldown(86_400),
    )
    .await
    .expect("unchanged producer policy entered a blocked write")
    .unwrap();

    sqlx::query("ROLLBACK").execute(&mut *writer).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn idle_polling_and_producer_refresh_do_not_delay_leases_or_new_claims() {
    let root = tempdir().unwrap();
    let config = contention_config(root.path().to_path_buf());
    let store = Store::open(&config.database_path()).await.unwrap();
    let harness = Arc::new(Harness::new(
        config,
        store.clone(),
        Arc::new(FailingRunner::default()),
    ));
    harness.bootstrap().await.unwrap();
    assert!(harness.replenish().await.unwrap());
    insert_task(&store, "active-task", "active", "2026-07-15T12:00:00Z").await;
    assert_eq!(
        store.claim("active").await.unwrap().unwrap().id,
        "active-task"
    );
    let initial_lease = task_state(&store, "active-task").await.1.unwrap();

    let (stop, stopped) = watch::channel(false);
    let (claimed, mut claims) = mpsc::unbounded_channel();
    let mut pollers = Vec::new();
    for _ in 0..4 {
        let store = store.clone();
        let claimed = claimed.clone();
        let mut stopped = stopped.clone();
        pollers.push(tokio::spawn(async move {
            let mut poll = tokio::time::interval(Duration::from_millis(50));
            loop {
                tokio::select! {
                    _ = poll.tick() => {
                        let started = tokio::time::Instant::now();
                        if let Some(task) = store.claim("idle").await.unwrap() {
                            claimed.send(task.id).unwrap();
                        }
                        assert!(
                            started.elapsed() < Duration::from_millis(250),
                            "idle claim exceeded 250ms: {:?}",
                            started.elapsed()
                        );
                    }
                    changed = stopped.changed() => {
                        if changed.is_err() || *stopped.borrow() {
                            break;
                        }
                    }
                }
            }
        }));
    }
    drop(claimed);

    let producer = {
        let harness = harness.clone();
        let mut stopped = stopped.clone();
        tokio::spawn(async move {
            let mut refresh = tokio::time::interval(Duration::from_millis(50));
            loop {
                tokio::select! {
                    _ = refresh.tick() => {
                        let started = tokio::time::Instant::now();
                        harness.replenish().await.unwrap();
                        assert!(
                            started.elapsed() < Duration::from_millis(250),
                            "producer refresh exceeded 250ms: {:?}",
                            started.elapsed()
                        );
                    }
                    changed = stopped.changed() => {
                        if changed.is_err() || *stopped.borrow() {
                            break;
                        }
                    }
                }
            }
        })
    };

    let started = tokio::time::Instant::now();
    let mut heartbeat = tokio::time::interval(Duration::from_millis(100));
    let mut renewals = 0;
    while started.elapsed() < Duration::from_secs(2) {
        heartbeat.tick().await;
        let renewal = tokio::time::Instant::now();
        store.renew_claim("active-task", "active").await.unwrap();
        assert!(
            renewal.elapsed() < Duration::from_millis(250),
            "lease renewal exceeded 250ms: {:?}",
            renewal.elapsed()
        );
        renewals += 1;
    }
    assert!(renewals >= 20);
    let renewed_lease = task_state(&store, "active-task").await.1.unwrap();
    assert!(renewed_lease > initial_lease);

    let task_id = store
        .create_message("human", "idle", "new-work", "Claim promptly")
        .await
        .unwrap();
    let claim_started = tokio::time::Instant::now();
    let claimed_id = tokio::time::timeout(Duration::from_millis(250), claims.recv())
        .await
        .expect("new task was not claimed within 250ms")
        .expect("idle pollers stopped before claiming");
    assert_eq!(claimed_id, task_id);
    assert!(claim_started.elapsed() < Duration::from_millis(250));

    stop.send_replace(true);
    for poller in pollers {
        poller.await.unwrap();
    }
    producer.await.unwrap();
    assert!(claims.try_recv().is_err());
    let state = task_state(&store, &task_id).await;
    assert_eq!(state.0, "claimed");
    assert_eq!(state.2, 1);
}

#[tokio::test]
async fn delegated_work_is_claimed_after_a_bounded_direct_burst() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    store.register(&worker("agent")).await.unwrap();
    insert_queue_task(
        &store,
        "automatic-seed",
        "agent",
        "automatic",
        "pending",
        "2026-07-15T09:00:00Z",
    )
    .await;
    insert_queue_task(
        &store,
        "delegation",
        "agent",
        "agent",
        "pending",
        "2026-07-15T10:00:00Z",
    )
    .await;
    for (id, created_at) in [
        ("message-1", "2026-07-15T10:01:00Z"),
        ("message-2", "2026-07-15T10:02:00Z"),
    ] {
        insert_queue_task(&store, id, "agent", "manual", "pending", created_at).await;
    }

    for expected in ["message-1", "message-2"] {
        let claimed = store.claim("agent").await.unwrap().unwrap();
        assert_eq!(claimed.id, expected);
        store.finish(expected, "completed", None).await.unwrap();
    }
    insert_queue_task(
        &store,
        "message-3",
        "agent",
        "manual",
        "pending",
        "2026-07-15T10:03:00Z",
    )
    .await;
    let third = store.claim("agent").await.unwrap().unwrap();
    assert_eq!(third.id, "message-3");
    store.finish("message-3", "completed", None).await.unwrap();
    insert_queue_task(
        &store,
        "message-4",
        "agent",
        "manual",
        "pending",
        "2026-07-15T10:04:00Z",
    )
    .await;

    let delegation = store.claim("agent").await.unwrap().unwrap();
    assert_eq!(delegation.id, "delegation");
    store
        .retry("delegation", "retry without resetting fairness")
        .await
        .unwrap();
    assert_eq!(
        store.claim("agent").await.unwrap().unwrap().id,
        "delegation"
    );
    store.finish("delegation", "completed", None).await.unwrap();
    assert_eq!(store.claim("agent").await.unwrap().unwrap().id, "message-4");
    store.finish("message-4", "completed", None).await.unwrap();
    assert_eq!(
        store.claim("agent").await.unwrap().unwrap().id,
        "automatic-seed"
    );
}

#[tokio::test]
async fn fairness_is_per_assignee_and_deferred_work_stays_ineligible() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for id in ["agent", "other"] {
        store.register(&worker(id)).await.unwrap();
    }
    insert_queue_task(
        &store,
        "delegation",
        "agent",
        "agent",
        "pending",
        "2026-07-15T10:00:00Z",
    )
    .await;
    insert_queue_task(
        &store,
        "direct",
        "agent",
        "manual",
        "pending",
        "2026-07-15T10:01:00Z",
    )
    .await;
    for index in 1..=MAX_DIRECT_CLAIMS_BEFORE_DELEGATION {
        let id = format!("other-{index}");
        insert_queue_task(
            &store,
            &id,
            "other",
            "manual",
            "completed",
            &format!("2026-07-15T10:0{}:00Z", index + 1),
        )
        .await;
        sqlx::query("UPDATE tasks SET attempts=1 WHERE id=?")
            .bind(id)
            .execute(&store.pool)
            .await
            .unwrap();
    }

    assert_eq!(store.claim("agent").await.unwrap().unwrap().id, "direct");
    store.finish("direct", "completed", None).await.unwrap();
    sqlx::query("UPDATE tasks SET status='deferred' WHERE id='delegation'")
        .execute(&store.pool)
        .await
        .unwrap();
    insert_queue_task(
        &store,
        "automatic",
        "agent",
        "automatic",
        "pending",
        "2026-07-15T09:00:00Z",
    )
    .await;
    assert_eq!(store.claim("agent").await.unwrap().unwrap().id, "automatic");
    assert_eq!(task_state(&store, "delegation").await.0, "deferred");
}

#[tokio::test]
async fn cancelling_a_claimed_task_interrupts_the_run_and_releases_capacity() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker).await.unwrap();
    let cancelled_id = store
        .create_message("human", &worker.id, "cancel", "Block until cancelled")
        .await
        .unwrap();
    let (events, mut event_rx) = mpsc::unbounded_channel();
    let runner = Arc::new(CancellationRunner {
        calls: AtomicUsize::new(0),
        events,
        store: store.clone(),
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let gate = Arc::new(Semaphore::new(1));
    let ctx = Arc::new(WorkerContext {
        config,
        config_path: None,
        worker: worker.clone(),
        store: store.clone(),
        runner: runner.clone(),
        gate: gate.clone(),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(2)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 2,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 25,
        },
        shutdown,
    });
    let task = store.claim(&worker.id).await.unwrap().unwrap();
    let running_ctx = ctx.clone();
    let running = tokio::spawn(async move { process(&running_ctx, task).await });
    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(1), event_rx.recv())
            .await
            .unwrap(),
        Some("started")
    );

    sqlx::query(
        "UPDATE tasks SET status='cancelled',claimed_at=NULL,completed_at=? WHERE id=? AND status='claimed'",
    )
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(&cancelled_id)
    .execute(&store.pool)
    .await
    .unwrap();

    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(1), event_rx.recv())
            .await
            .unwrap(),
        Some("cancelled")
    );
    tokio::time::timeout(std::time::Duration::from_secs(1), running)
        .await
        .expect("cancelled run did not release the worker")
        .unwrap()
        .unwrap();
    assert_eq!(gate.available_permits(), 1);
    assert_eq!(
        task_outcome(&store, &cancelled_id).await,
        ("cancelled".into(), None, None, 1)
    );
    assert_eq!(table_count(&store, "turns").await, 0);
    assert_eq!(table_count(&store, "releases").await, 0);
    assert_eq!(store.agent(&worker.id).await.unwrap().status, "idle");

    let next_id = store
        .create_message("human", &worker.id, "next", "Complete next")
        .await
        .unwrap();
    let next = store.claim(&worker.id).await.unwrap().unwrap();
    process(&ctx, next).await.unwrap();
    assert_eq!(
        task_outcome(&store, &next_id).await,
        (
            "completed".into(),
            Some("completed after cancellation".into()),
            None,
            1
        )
    );
    assert_eq!(runner.calls.load(Ordering::SeqCst), 2);
    assert_eq!(gate.available_permits(), 1);
}

#[tokio::test]
async fn peer_context_interrupts_and_restarts_claimed_work_without_consuming_an_attempt() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker_spec = config.workers().remove(0);
    let leader = config.leader().to_string();
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker_spec).await.unwrap();
    store.register(&worker("sender")).await.unwrap();
    let task_id = store
        .create_message(
            "human",
            &worker_spec.id,
            "target",
            "Block until context arrives",
        )
        .await
        .unwrap();
    store
        .create_message("human", "sender", "source", "Send context")
        .await
        .unwrap();
    let (events, mut event_rx) = mpsc::unbounded_channel();
    let runner = Arc::new(CancellationRunner {
        calls: AtomicUsize::new(0),
        events,
        store: store.clone(),
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let ctx = Arc::new(WorkerContext {
        config,
        config_path: None,
        worker: worker_spec.clone(),
        store: store.clone(),
        runner: runner.clone(),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(2)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 2,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 25,
        },
        shutdown,
    });
    let task = store.claim(&worker_spec.id).await.unwrap().unwrap();
    let running_ctx = ctx.clone();
    let running = tokio::spawn(async move { process(&running_ctx, task).await });
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), event_rx.recv())
            .await
            .unwrap(),
        Some("started")
    );
    store.claim("sender").await.unwrap().unwrap();

    let context_id = store
        .send_peer_message(
            "sender",
            &worker_spec.id,
            "constraint",
            "Use the revised contract.",
        )
        .await
        .unwrap();

    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), event_rx.recv())
            .await
            .unwrap(),
        Some("cancelled")
    );
    running.await.unwrap().unwrap();
    assert_eq!(
        task_state(&store, &task_id).await,
        ("pending".into(), None, 0, None)
    );
    assert_eq!(
        store
            .send_peer_message(
                "sender",
                &worker_spec.id,
                "constraint",
                "Use the revised contract.",
            )
            .await
            .unwrap(),
        context_id
    );
    let second_context_id = store
        .send_peer_message(
            "sender",
            &worker_spec.id,
            "question",
            "Does the revised contract include retries?",
        )
        .await
        .unwrap();
    assert_ne!(second_context_id, context_id);
    let restarted = store.claim(&worker_spec.id).await.unwrap().unwrap();
    let context = store.runtime_context(&restarted, &leader).await.unwrap();
    assert!(context.contains("Use the revised contract."));
    assert!(context.contains("Does the revised contract include retries?"));
    process(&ctx, restarted).await.unwrap();
    assert_eq!(store.task_status(&task_id).await.unwrap(), "completed");
    assert_eq!(runner.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn worker_loop_survives_context_transition_race_and_drains_promoted_work() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker_spec = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    for agent in [&worker_spec.id, "lead", "sender"] {
        store.register(&worker(agent)).await.unwrap();
    }
    let interrupted = store
        .create_message("human", &worker_spec.id, "target", "Apply context")
        .await
        .unwrap();
    store
        .create_message("human", "lead", "root", "Delegate follow-up")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let buffered = store
        .delegate_current("lead", &worker_spec.id, "follow-up", "Run after context")
        .await
        .unwrap();
    assert_eq!(store.task_status(&buffered).await.unwrap(), "buffered");
    store
        .create_message("human", "sender", "source", "Send context")
        .await
        .unwrap();
    store.claim("sender").await.unwrap().unwrap();

    let (shutdown_tx, shutdown) = watch::channel(false);
    let runner = Arc::new(TransitionRaceRunner {
        calls: AtomicUsize::new(0),
        store: store.clone(),
        shutdown: shutdown_tx,
    });
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker: worker_spec.clone(),
        store: store.clone(),
        runner: runner.clone(),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(3)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 3,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 250,
        },
        shutdown,
    };

    tokio::time::timeout(Duration::from_secs(2), run_worker(ctx))
        .await
        .expect("worker loop exited neither cleanly nor after draining queued work")
        .unwrap();

    assert_eq!(
        task_outcome(&store, &interrupted).await,
        (
            "completed".into(),
            Some("completed reclaimed message".into()),
            None,
            1
        )
    );
    assert_eq!(
        task_outcome(&store, &buffered).await,
        (
            "completed".into(),
            Some("completed promoted work".into()),
            None,
            1
        )
    );
    assert_eq!(runner.calls.load(Ordering::SeqCst), 3);
    assert_eq!(store.agent(&worker_spec.id).await.unwrap().status, "idle");
    assert_eq!(table_count(&store, "task_context").await, 1);
}

#[tokio::test]
async fn stale_error_after_context_transition_is_not_recorded() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker_spec = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    for agent in [&worker_spec.id, "sender"] {
        store.register(&worker(agent)).await.unwrap();
    }
    let task_id = store
        .create_message("human", &worker_spec.id, "target", "Apply context")
        .await
        .unwrap();
    store
        .create_message("human", "sender", "source", "Send context")
        .await
        .unwrap();
    store.claim("sender").await.unwrap().unwrap();
    let (_shutdown_tx, shutdown) = watch::channel(false);
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker: worker_spec.clone(),
        store: store.clone(),
        runner: Arc::new(ErrorTransitionRaceRunner {
            store: store.clone(),
        }),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(1)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 1,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 250,
        },
        shutdown,
    };
    let task = store.claim(&worker_spec.id).await.unwrap().unwrap();

    process(&ctx, task).await.unwrap();

    assert_eq!(
        task_state(&store, &task_id).await,
        ("pending".into(), None, 0, None)
    );
    assert_eq!(table_count(&store, "turns").await, 0);
    assert_eq!(store.agent(&worker_spec.id).await.unwrap().status, "idle");
    assert_eq!(
        store.claim(&worker_spec.id).await.unwrap().unwrap().id,
        task_id
    );
}

#[tokio::test]
async fn principal_can_message_after_delegating_its_current_task() {
    principal_post_delegation_message_is_nonfatal(false).await;
}

#[tokio::test]
async fn principal_post_delegation_runner_error_keeps_coordination_waiting() {
    principal_post_delegation_message_is_nonfatal(true).await;
}

async fn principal_post_delegation_message_is_nonfatal(fail: bool) {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker_spec = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    for agent in [&worker_spec.id, "peer"] {
        store.register(&worker(agent)).await.unwrap();
    }
    let task_id = store
        .create_message("human", &worker_spec.id, "root", "Coordinate the repair")
        .await
        .unwrap();
    let (_shutdown_tx, shutdown) = watch::channel(false);
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker: worker_spec.clone(),
        store: store.clone(),
        runner: Arc::new(PrincipalTransitionRunner {
            store: store.clone(),
            fail,
        }),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(1)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 1,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 250,
        },
        shutdown,
    };
    let task = store.claim(&worker_spec.id).await.unwrap().unwrap();

    process(&ctx, task).await.unwrap();

    assert_eq!(store.task_status(&task_id).await.unwrap(), "waiting");
    let (child_id, child_status): (String, String) =
        sqlx::query_as("SELECT id,status FROM tasks WHERE parent_id=? AND kind='delegation'")
            .bind(&task_id)
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(child_status, "pending");
    assert_eq!(table_count(&store, "task_context").await, 1);
    let context_task: (String,) =
        sqlx::query_as("SELECT task_id FROM task_context ORDER BY created_at LIMIT 1")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(context_task.0, child_id);
    assert_eq!(turn_statuses(&store).await, vec!["waiting"]);
    assert_eq!(task_state(&store, &task_id).await.2, 0);
    assert_eq!(store.agent(&worker_spec.id).await.unwrap().status, "idle");
}

#[tokio::test]
async fn committed_transition_suppresses_followup_missing_claim_error() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker_spec = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    for agent in [&worker_spec.id, "peer"] {
        store.register(&worker(agent)).await.unwrap();
    }
    let task_id = store
        .create_message("human", &worker_spec.id, "root", "Complete the repair")
        .await
        .unwrap();
    let (_shutdown_tx, shutdown) = watch::channel(false);
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker: worker_spec.clone(),
        store: store.clone(),
        runner: Arc::new(CompleteThenMessageRunner {
            store: store.clone(),
        }),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(1)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 1,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 250,
        },
        shutdown,
    };
    let task = store.claim(&worker_spec.id).await.unwrap().unwrap();

    process(&ctx, task).await.unwrap();

    assert_eq!(
        task_outcome(&store, &task_id).await,
        (
            "completed".into(),
            Some("committed before follow-up".into()),
            None,
            1
        )
    );
    assert_eq!(turn_statuses(&store).await, vec!["completed"]);
    assert_eq!(store.agent(&worker_spec.id).await.unwrap().status, "idle");
}

#[tokio::test]
async fn post_delegation_message_propagates_unrelated_database_errors() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    for agent in ["lead", "peer"] {
        store.register(&worker(agent)).await.unwrap();
    }
    sqlx::query(
        "INSERT INTO tasks(id,kind,source,creator,assignee,topic,body,status,created_at)
         VALUES('newer-waiting-parent','message','agent','human','lead','other','Other work',
         'waiting','9999-01-01T00:00:00Z'),
         ('older-child','delegation','agent','lead','peer','other-child','Already delegated',
         'completed','2000-01-01T00:00:00Z')",
    )
    .execute(&store.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE tasks SET parent_id='newer-waiting-parent' WHERE id='older-child'")
        .execute(&store.pool)
        .await
        .unwrap();
    let parent_id = store
        .create_message("human", "lead", "root", "Coordinate the repair")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    store
        .set_state("lead", "working", Some("root"))
        .await
        .unwrap();
    store
        .delegate_current("lead", "peer", "repair", "Implement the repair")
        .await
        .unwrap();
    let missing = store.current_assignment("lead").await.unwrap_err();
    assert!(missing.to_string().contains("no currently claimed task"));
    assert_eq!(
        store
            .active_coordination_assignment("lead")
            .await
            .unwrap()
            .id,
        parent_id
    );
    sqlx::query("DROP TABLE task_context")
        .execute(&store.pool)
        .await
        .unwrap();

    let error = store
        .send_peer_message("lead", "peer", "constraint", "Preserve the invariant")
        .await
        .unwrap_err();

    assert!(format!("{error:#}").contains("no such table: task_context"));
}

#[tokio::test]
async fn stale_success_after_cancelled_child_transition_is_not_recorded() {
    cancelled_child_transition_discards_runner_result(false).await;
}

#[tokio::test]
async fn stale_error_after_cancelled_child_transition_is_not_recorded() {
    cancelled_child_transition_discards_runner_result(true).await;
}

async fn cancelled_child_transition_discards_runner_result(fail: bool) {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker_spec = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    for agent in [&worker_spec.id, "lead"] {
        store.register(&worker(agent)).await.unwrap();
    }
    let parent = store
        .create_message("human", "lead", "parent", "Cancel active validation")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let cancelled = store
        .delegate_current("lead", &worker_spec.id, "validation", "Validate.")
        .await
        .unwrap();
    let dependency_parent = store
        .create_message("human", "lead", "dependency", "Queue dependent work")
        .await
        .unwrap();
    store.claim("lead").await.unwrap().unwrap();
    let buffered = store
        .delegate_current("lead", &worker_spec.id, "follow-up", "Run after validation")
        .await
        .unwrap();
    assert_eq!(store.task_status(&buffered).await.unwrap(), "buffered");
    let task = store.claim(&worker_spec.id).await.unwrap().unwrap();
    assert_eq!(task.id, cancelled);
    let (_shutdown_tx, shutdown) = watch::channel(false);
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker: worker_spec.clone(),
        store: store.clone(),
        runner: Arc::new(CancelledChildTransitionRunner {
            store: store.clone(),
            task_id: cancelled.clone(),
            parent_id: parent.clone(),
            fail,
        }),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(1)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 1,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 250,
        },
        shutdown,
    };

    process(&ctx, task).await.unwrap();

    assert_eq!(store.task_status(&cancelled).await.unwrap(), "cancelled");
    assert_eq!(store.task_status(&parent).await.unwrap(), "completed");
    assert_eq!(
        store.task_status(&dependency_parent).await.unwrap(),
        "waiting"
    );
    assert_eq!(store.task_status(&buffered).await.unwrap(), "pending");
    assert_eq!(table_count(&store, "turns").await, 0);
    assert_eq!(store.agent(&worker_spec.id).await.unwrap().status, "idle");
    assert_eq!(
        store.claim(&worker_spec.id).await.unwrap().unwrap().id,
        buffered
    );
}

#[tokio::test]
async fn pausing_an_active_agent_interrupts_and_resumes_without_overlap() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker).await.unwrap();
    store
        .set_session(&worker.id, "reusable-session")
        .await
        .unwrap();
    let task_id = store
        .create_message("human", &worker.id, "pause", "Block until paused")
        .await
        .unwrap();
    let (events, mut event_rx) = mpsc::unbounded_channel();
    let (release_tx, release_rx) = oneshot::channel();
    let runner = Arc::new(PauseRunner {
        calls: AtomicUsize::new(0),
        active: Arc::new(AtomicUsize::new(0)),
        max_active: Arc::new(AtomicUsize::new(0)),
        events,
        release: Mutex::new(Some(release_rx)),
        store: store.clone(),
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let gate = Arc::new(Semaphore::new(1));
    let ctx = Arc::new(WorkerContext {
        config,
        config_path: None,
        worker: worker.clone(),
        store: store.clone(),
        runner: runner.clone(),
        gate: gate.clone(),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(2)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 2,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 25,
        },
        shutdown,
    });
    let task = store.claim(&worker.id).await.unwrap().unwrap();
    let running_ctx = ctx.clone();
    let running = tokio::spawn(async move { process(&running_ctx, task).await });
    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(1), event_rx.recv())
            .await
            .unwrap(),
        Some("started")
    );

    sqlx::query(
        "UPDATE tasks SET status='deferred',claimed_at=NULL,error='Paused by operator'
         WHERE id=? AND status='claimed'",
    )
    .bind(&task_id)
    .execute(&store.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO operator_pauses(agent_id) VALUES(?)")
        .bind(&worker.id)
        .execute(&store.pool)
        .await
        .unwrap();
    store.set_state(&worker.id, "paused", None).await.unwrap();

    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(1), event_rx.recv())
            .await
            .unwrap(),
        Some("cancelled")
    );
    assert_eq!(
        task_outcome(&store, &task_id).await,
        (
            "deferred".into(),
            None,
            Some("Paused by operator".into()),
            1
        )
    );
    assert_eq!(store.agent(&worker.id).await.unwrap().status, "paused");
    assert_eq!(gate.available_permits(), 0);
    assert_eq!(table_count(&store, "turns").await, 0);
    assert_eq!(table_count(&store, "releases").await, 0);

    store.set_state(&worker.id, "idle", None).await.unwrap();
    sqlx::query("DELETE FROM operator_pauses WHERE agent_id=?")
        .bind(&worker.id)
        .execute(&store.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE tasks SET status='pending',error=NULL
         WHERE id=? AND status='deferred' AND error='Paused by operator'",
    )
    .bind(&task_id)
    .execute(&store.pool)
    .await
    .unwrap();
    let _ = release_tx.send(());
    tokio::time::timeout(std::time::Duration::from_secs(1), running)
        .await
        .expect("paused run did not drain and release the worker")
        .unwrap()
        .unwrap();
    assert_eq!(gate.available_permits(), 1);

    let resumed = store.claim(&worker.id).await.unwrap().unwrap();
    process(&ctx, resumed).await.unwrap();
    assert_eq!(
        task_outcome(&store, &task_id).await,
        (
            "completed".into(),
            Some("completed after pause".into()),
            None,
            2
        )
    );
    assert_eq!(runner.calls.load(Ordering::SeqCst), 2);
    assert_eq!(runner.max_active.load(Ordering::SeqCst), 1);
    assert_eq!(
        store.agent(&worker.id).await.unwrap().session_id,
        "reusable-session"
    );
    assert_eq!(gate.available_permits(), 1);
}

#[tokio::test]
async fn late_cancellation_does_not_overwrite_a_committed_completion() {
    let root = tempdir().unwrap();
    let store = Store::open(&root.path().join("harness.db")).await.unwrap();
    let worker = worker("agent");
    store.register(&worker).await.unwrap();
    let task_id = store
        .create_message("human", &worker.id, "complete", "Complete first")
        .await
        .unwrap();
    store.claim(&worker.id).await.unwrap().unwrap();
    store
        .complete_current(&worker.id, "committed result")
        .await
        .unwrap();

    let cancelled = sqlx::query(
        "UPDATE tasks SET status='cancelled',claimed_at=NULL,completed_at=?
         WHERE id=? AND status='claimed'",
    )
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(&task_id)
    .execute(&store.pool)
    .await
    .unwrap()
    .rows_affected();

    assert_eq!(cancelled, 0);
    assert_eq!(
        task_outcome(&store, &task_id).await,
        ("completed".into(), Some("committed result".into()), None, 1)
    );
}

#[tokio::test]
async fn late_agent_pause_does_not_hide_a_committed_completion() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker).await.unwrap();
    let task_id = store
        .create_message("human", &worker.id, "complete", "Commit before pause")
        .await
        .unwrap();
    let task = store.claim(&worker.id).await.unwrap().unwrap();
    let (committed_tx, committed_rx) = oneshot::channel();
    let runner = Arc::new(CommitBeforePauseRunner {
        store: store.clone(),
        committed: Mutex::new(Some(committed_tx)),
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let ctx = Arc::new(WorkerContext {
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
    });
    let running_ctx = ctx.clone();
    let running = tokio::spawn(async move { process(&running_ctx, task).await });
    tokio::time::timeout(std::time::Duration::from_secs(1), committed_rx)
        .await
        .expect("runner did not commit before pause")
        .unwrap();

    sqlx::query("INSERT INTO operator_pauses(agent_id) VALUES(?)")
        .bind(&worker.id)
        .execute(&store.pool)
        .await
        .unwrap();
    store.set_state(&worker.id, "paused", None).await.unwrap();

    tokio::time::timeout(std::time::Duration::from_secs(1), running)
        .await
        .expect("committed run did not finish after pause")
        .unwrap()
        .unwrap();
    assert_eq!(
        task_outcome(&store, &task_id).await,
        (
            "completed".into(),
            Some("committed before pause".into()),
            None,
            1
        )
    );
    assert_eq!(store.agent(&worker.id).await.unwrap().status, "paused");
    assert_eq!(table_count(&store, "turns").await, 1);
}

#[tokio::test]
async fn rapid_pause_resume_between_polls_discards_the_old_turn_result() {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker).await.unwrap();
    let task_id = store
        .create_message("human", &worker.id, "pause", "Resume immediately")
        .await
        .unwrap();
    let task = store.claim(&worker.id).await.unwrap().unwrap();
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let runner = Arc::new(RapidResumeRunner {
        calls: AtomicUsize::new(0),
        started: Mutex::new(Some(started_tx)),
        release: Mutex::new(Some(release_rx)),
        store: store.clone(),
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let ctx = Arc::new(WorkerContext {
        config,
        config_path: None,
        worker: worker.clone(),
        store: store.clone(),
        runner: runner.clone(),
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(2)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: 2,
            max_attempts: 3,
            claim_lease_ms: 60_000,
            poll_interval_ms: 250,
        },
        shutdown,
    });
    let running_ctx = ctx.clone();
    let running = tokio::spawn(async move { process(&running_ctx, task).await });
    tokio::time::timeout(std::time::Duration::from_secs(1), started_rx)
        .await
        .expect("old turn did not start")
        .unwrap();

    let mut transaction = store.pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    sqlx::query(
        "UPDATE tasks SET status='deferred',claimed_at=NULL,error='Paused by operator'
         WHERE id=? AND status='claimed'",
    )
    .bind(&task_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query("INSERT INTO operator_pauses(agent_id) VALUES(?)")
        .bind(&worker.id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("UPDATE agents SET status='paused' WHERE agent_id=?")
        .bind(&worker.id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("DELETE FROM operator_pauses WHERE agent_id=?")
        .bind(&worker.id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE tasks SET status='pending',error=NULL
         WHERE id=? AND status='deferred' AND error='Paused by operator'",
    )
    .bind(&task_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query("UPDATE agents SET status='idle' WHERE agent_id=?")
        .bind(&worker.id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    transaction.commit().await.unwrap();
    let _ = release_tx.send(());

    tokio::time::timeout(std::time::Duration::from_secs(1), running)
        .await
        .expect("old turn did not exit after rapid resume")
        .unwrap()
        .unwrap();
    assert_eq!(
        task_outcome(&store, &task_id).await,
        ("pending".into(), None, None, 1)
    );
    assert_eq!(table_count(&store, "turns").await, 0);

    let resumed = store.claim(&worker.id).await.unwrap().unwrap();
    process(&ctx, resumed).await.unwrap();
    assert_eq!(
        task_outcome(&store, &task_id).await,
        (
            "completed".into(),
            Some("completed after rapid resume".into()),
            None,
            2
        )
    );
    assert_eq!(runner.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn instructions_reload_after_waiting_for_the_project_permit() {
    let directory = tempdir().unwrap();
    let root = directory.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    let config_path = directory.path().join("project.json");
    write_live_config(&config_path, &root, "Old role", "Old prompt.", "Old peer");
    let config = ProjectConfig::load(&config_path).unwrap();
    let worker = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker).await.unwrap();
    store
        .set_session(&worker.id, "existing-session")
        .await
        .unwrap();
    store
        .create_message("human", &worker.id, "work", "Use current instructions")
        .await
        .unwrap();
    let task = store.claim(&worker.id).await.unwrap().unwrap();
    let gate = Arc::new(Semaphore::new(1));
    let held_permit = gate.clone().acquire_owned().await.unwrap();
    let (requests, mut request_rx) = mpsc::unbounded_channel();
    let runner = Arc::new(PromptRunner {
        store: store.clone(),
        requests,
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let ctx = Arc::new(WorkerContext {
        config,
        config_path: Some(config_path.clone()),
        worker,
        store,
        runner,
        gate,
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
    });
    let process_ctx = ctx.clone();
    let running = tokio::spawn(async move { process(&process_ctx, task).await });

    write_live_config(&config_path, &root, "New role", "New prompt.", "New peer");
    drop(held_permit);
    let request = tokio::time::timeout(std::time::Duration::from_secs(1), request_rx.recv())
        .await
        .expect("runner did not receive the queued turn")
        .expect("request channel closed");
    tokio::time::timeout(std::time::Duration::from_secs(1), running)
        .await
        .expect("queued turn did not complete")
        .unwrap()
        .unwrap();

    assert_eq!(request.worker.description, "New role");
    assert_eq!(request.worker.prompt, "New prompt.");
    assert!(request.full_prompt().contains("New role. New prompt."));
    assert!(request.full_prompt().contains("peer=New peer"));
    assert_eq!(request.session_id, "existing-session");
}

#[derive(Default)]
struct FailingRunner {
    calls: AtomicUsize,
}

struct RetryLifecycleRunner {
    steps: Mutex<VecDeque<RetryStep>>,
    store: Store,
}

enum RetryStep {
    Error(&'static str),
    MissingTransition,
    Complete,
}

struct CancellationRunner {
    calls: AtomicUsize,
    events: mpsc::UnboundedSender<&'static str>,
    store: Store,
}

struct PauseRunner {
    calls: AtomicUsize,
    active: Arc<AtomicUsize>,
    max_active: Arc<AtomicUsize>,
    events: mpsc::UnboundedSender<&'static str>,
    release: Mutex<Option<oneshot::Receiver<()>>>,
    store: Store,
}

struct CommitBeforePauseRunner {
    store: Store,
    committed: Mutex<Option<oneshot::Sender<()>>>,
}

struct RapidResumeRunner {
    calls: AtomicUsize,
    started: Mutex<Option<oneshot::Sender<()>>>,
    release: Mutex<Option<oneshot::Receiver<()>>>,
    store: Store,
}

struct TransitionRaceRunner {
    calls: AtomicUsize,
    store: Store,
    shutdown: watch::Sender<bool>,
}

struct ErrorTransitionRaceRunner {
    store: Store,
}

struct PrincipalTransitionRunner {
    store: Store,
    fail: bool,
}

struct CompleteThenMessageRunner {
    store: Store,
}

struct CancelledChildTransitionRunner {
    store: Store,
    task_id: String,
    parent_id: String,
    fail: bool,
}

impl AgentRunner for PrincipalTransitionRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.store
                .delegate_current(&request.worker.id, "peer", "repair", "Implement the repair")
                .await?;
            self.store
                .send_peer_message(
                    &request.worker.id,
                    "peer",
                    "constraint",
                    "Preserve the claimed task identity",
                )
                .await?;
            if self.fail {
                return Err(anyhow!("injected error after coordination transition"));
            }
            Ok(AgentOutput {
                summary: "coordinated repair".into(),
                deliverable: None,
                tools: Vec::new(),
                complete: false,
            })
        })
    }
}

impl AgentRunner for CompleteThenMessageRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.store
                .complete_current(&request.worker.id, "committed before follow-up")
                .await?;
            self.store
                .send_peer_message(
                    &request.worker.id,
                    "peer",
                    "late",
                    "This must not replace the committed transition",
                )
                .await?;
            unreachable!("message_send must reject a completed task without active coordination")
        })
    }
}

impl AgentRunner for CancelledChildTransitionRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let now = chrono::Utc::now().to_rfc3339();
            let mut transaction = self.store.pool.begin_with("BEGIN IMMEDIATE").await?;
            sqlx::query(
                "UPDATE tasks SET status='cancelled',claimed_at=NULL,completed_at=?
                 WHERE id=? AND status='claimed'",
            )
            .bind(now)
            .bind(&self.task_id)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "UPDATE tasks SET status='pending',claimed_at=NULL
                 WHERE id=? AND status='waiting'
                 AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=tasks.id
                   AND child.status IN ('pending','claimed','waiting','deferred','buffered','backlog'))",
            )
            .bind(&self.parent_id)
            .execute(&mut *transaction)
            .await?;
            transaction.commit().await?;
            self.store
                .promote_buffered_for_agent(&request.worker.id)
                .await?;
            self.store.claim("lead").await?.unwrap();
            self.store
                .complete_current("lead", "context transition complete")
                .await?;
            if self.fail {
                Err(anyhow!("agent has no currently claimed task"))
            } else {
                Ok(AgentOutput {
                    summary: "stale success after cancellation".into(),
                    deliverable: Some("stale success after cancellation".into()),
                    tools: Vec::new(),
                    complete: true,
                })
            }
        })
    }
}

impl AgentRunner for ErrorTransitionRaceRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.store
                .send_peer_message(
                    "sender",
                    &request.worker.id,
                    "constraint",
                    "Use the repaired transition.",
                )
                .await?;
            Err(anyhow!("stale error after claim release"))
        })
    }
}

impl AgentRunner for TransitionRaceRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            let result = match call {
                0 => {
                    self.store
                        .send_peer_message(
                            "sender",
                            &request.worker.id,
                            "constraint",
                            "Use the repaired transition.",
                        )
                        .await?;
                    "stale result after claim release"
                }
                1 => {
                    self.store
                        .complete_current(&request.worker.id, "completed reclaimed message")
                        .await?;
                    "completed reclaimed message"
                }
                _ => {
                    self.store
                        .complete_current(&request.worker.id, "completed promoted work")
                        .await?;
                    self.shutdown.send_replace(true);
                    "completed promoted work"
                }
            };
            Ok(AgentOutput {
                summary: result.into(),
                deliverable: Some(result.into()),
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

impl AgentRunner for RapidResumeRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            if call == 0 {
                let release = self.release.lock().unwrap().take().unwrap();
                if let Some(started) = self.started.lock().unwrap().take() {
                    let _ = started.send(());
                }
                let _ = release.await;
                return Ok(AgentOutput {
                    summary: "stale pre-pause result".into(),
                    deliverable: Some("stale pre-pause result".into()),
                    tools: Vec::new(),
                    complete: true,
                });
            }
            self.store
                .complete_current(&request.worker.id, "completed after rapid resume")
                .await?;
            Ok(AgentOutput {
                summary: "completed after rapid resume".into(),
                deliverable: Some("completed after rapid resume".into()),
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

impl AgentRunner for CommitBeforePauseRunner {
    fn run<'a>(
        &'a self,
        mut request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.store
                .complete_current(&request.worker.id, "committed before pause")
                .await?;
            if let Some(committed) = self.committed.lock().unwrap().take() {
                let _ = committed.send(());
            }
            while !*request.cancellation.borrow() {
                request.cancellation.changed().await?;
            }
            Err(anyhow!("agent run cancelled"))
        })
    }
}

struct RunnerActiveGuard(Arc<AtomicUsize>);

impl RunnerActiveGuard {
    fn new(active: Arc<AtomicUsize>, max_active: &AtomicUsize) -> Self {
        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
        max_active.fetch_max(current, Ordering::SeqCst);
        Self(active)
    }
}

impl Drop for RunnerActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl AgentRunner for PauseRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        let events = self.events.clone();
        Box::pin(async move {
            let _active = RunnerActiveGuard::new(self.active.clone(), &self.max_active);
            if call == 0 {
                let mut cancellation = request.cancellation;
                let release = self.release.lock().unwrap().take().unwrap();
                let _ = events.send("started");
                while !*cancellation.borrow() {
                    cancellation.changed().await?;
                }
                let _ = events.send("cancelled");
                let _ = release.await;
                return Err(anyhow!("agent run cancelled"));
            }
            self.store
                .complete_current(&request.worker.id, "completed after pause")
                .await?;
            Ok(AgentOutput {
                summary: "completed after pause".into(),
                deliverable: Some("completed after pause".into()),
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

impl AgentRunner for CancellationRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        let events = self.events.clone();
        if call == 0 {
            Box::pin(async move {
                let mut cancellation = request.cancellation;
                let _ = events.send("started");
                while !*cancellation.borrow() {
                    cancellation.changed().await?;
                }
                let _ = events.send("cancelled");
                Err(anyhow!("agent run cancelled"))
            })
        } else {
            let store = self.store.clone();
            let worker_id = request.worker.id;
            Box::pin(async move {
                store
                    .complete_current(&worker_id, "completed after cancellation")
                    .await?;
                Ok(AgentOutput {
                    summary: "completed after cancellation".into(),
                    deliverable: Some("completed after cancellation".into()),
                    tools: Vec::new(),
                    complete: true,
                })
            })
        }
    }
}

struct PromptRunner {
    store: Store,
    requests: mpsc::UnboundedSender<RunRequest>,
}

impl AgentRunner for PromptRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        Box::pin(async move {
            let worker_id = request.worker.id.clone();
            let _ = self.requests.send(request);
            self.store.complete_current(&worker_id, "completed").await?;
            Ok(AgentOutput {
                summary: "completed".into(),
                deliverable: Some("completed".into()),
                tools: Vec::new(),
                complete: true,
            })
        })
    }
}

impl AgentRunner for FailingRunner {
    fn run<'a>(
        &'a self,
        _request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(anyhow!("injected runner failure")) })
    }
}

impl AgentRunner for RetryLifecycleRunner {
    fn run<'a>(
        &'a self,
        request: RunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<AgentOutput>> + Send + 'a>> {
        let step = self.steps.lock().unwrap().pop_front().unwrap();
        Box::pin(async move {
            match step {
                RetryStep::Error(error) => Err(anyhow!(error)),
                RetryStep::MissingTransition => Ok(AgentOutput {
                    summary: "Produced output without committing".into(),
                    deliverable: Some("uncommitted draft".into()),
                    tools: Vec::new(),
                    complete: true,
                }),
                RetryStep::Complete => {
                    self.store
                        .complete_current(&request.worker.id, "completed after retry")
                        .await?;
                    Ok(AgentOutput {
                        summary: "completed after retry".into(),
                        deliverable: Some("completed after retry".into()),
                        tools: Vec::new(),
                        complete: true,
                    })
                }
            }
        })
    }
}

fn project_config(root: std::path::PathBuf) -> ProjectConfig {
    ProjectConfig {
        name: "Budget test".into(),
        root,
        paused: false,
        configuration_revision: 0,
        agent_deletion_operations: Vec::new(),
        leader: Some("worker".into()),
        leader_task_limit: Some(3),
        max_active_tasks: None,
        idea_agents: Vec::new(),
        delegate_agents: Vec::new(),
        producer: None,
        producer_limit: None,
        producer_prompt: None,
        producer_retry_cooldown_seconds: 86_400,
        work_dir: None,
        roles: vec![RoleConfig {
            name: "worker".into(),
            agent_kind: None,
            source_agent: None,
            instance_ordinal: None,
            title: None,
            template: None,
            capabilities: Vec::new(),
            replica_eligible: false,
            description: "Worker".into(),
            prompt: "Work.".into(),
            model: None,
            appearance: None,
        }],
        copilot: CopilotConfig::default(),
    }
}

fn contention_config(root: std::path::PathBuf) -> ProjectConfig {
    ProjectConfig {
        name: "Contention test".into(),
        root,
        paused: false,
        configuration_revision: 0,
        agent_deletion_operations: Vec::new(),
        leader: Some("active".into()),
        leader_task_limit: Some(3),
        max_active_tasks: None,
        idea_agents: Vec::new(),
        delegate_agents: Vec::new(),
        producer: Some("producer".into()),
        producer_limit: Some(1),
        producer_prompt: None,
        producer_retry_cooldown_seconds: 86_400,
        work_dir: None,
        roles: ["active", "idle", "producer"]
            .into_iter()
            .map(|name| RoleConfig {
                name: name.into(),
                agent_kind: None,
                source_agent: None,
                instance_ordinal: None,
                title: None,
                template: None,
                capabilities: Vec::new(),
                replica_eligible: false,
                description: format!("{name} agent"),
                prompt: "Work.".into(),
                model: None,
                appearance: None,
            })
            .collect(),
        copilot: CopilotConfig::default(),
    }
}

fn worker(id: &str) -> WorkerSpec {
    WorkerSpec {
        id: id.into(),
        role: id.into(),
        description: format!("{id} agent"),
        prompt: "Work.".into(),
        model: "gpt-5.4-mini".into(),
        leader: "paused".into(),
        leader_task_limit: 3,
        idea_agents: Vec::new(),
        delegate_agents: Vec::new(),
    }
}

fn write_live_config(
    path: &std::path::Path,
    root: &std::path::Path,
    description: &str,
    prompt: &str,
    peer_description: &str,
) {
    std::fs::write(
        path,
        format!(
            r#"{{"name":"Live","root":{},"leader":"worker","roles":[{{"name":"worker","description":{},"prompt":{}}},{{"name":"peer","description":{},"prompt":"Peer."}}]}}"#,
            serde_json::to_string(root).unwrap(),
            serde_json::to_string(description).unwrap(),
            serde_json::to_string(prompt).unwrap(),
            serde_json::to_string(peer_description).unwrap(),
        ),
    )
    .unwrap();
}

async fn insert_task(store: &Store, id: &str, assignee: &str, created_at: &str) {
    insert_queue_task(store, id, assignee, "manual", "pending", created_at).await;
}

async fn insert_queue_task(
    store: &Store,
    id: &str,
    assignee: &str,
    source: &str,
    status: &str,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO tasks(id,kind,source,creator,assignee,topic,body,status,created_at)
         VALUES(?,'root',?,'human',?,'work','body',?,?)",
    )
    .bind(id)
    .bind(source)
    .bind(assignee)
    .bind(status)
    .bind(created_at)
    .execute(&store.pool)
    .await
    .unwrap();
}

async fn create_and_claim(store: &Store, topic: &str) -> Assignment {
    store
        .create_message("human", "agent", topic, "Run.")
        .await
        .unwrap();
    store.claim("agent").await.unwrap().unwrap()
}

async fn claim_snapshot(
    store: &Store,
    id: &str,
) -> (String, Option<String>, u32, i64, Option<String>) {
    sqlx::query_as("SELECT status,claimed_at,attempts,claim_generation,error FROM tasks WHERE id=?")
        .bind(id)
        .fetch_one(&store.pool)
        .await
        .unwrap()
}

async fn task_state(store: &Store, id: &str) -> (String, Option<String>, u32, Option<String>) {
    sqlx::query_as("SELECT status,claimed_at,attempts,error FROM tasks WHERE id=?")
        .bind(id)
        .fetch_one(&store.pool)
        .await
        .unwrap()
}

async fn task_outcome(store: &Store, id: &str) -> (String, Option<String>, Option<String>, u32) {
    sqlx::query_as("SELECT status,result,error,attempts FROM tasks WHERE id=?")
        .bind(id)
        .fetch_one(&store.pool)
        .await
        .unwrap()
}

async fn retry_lifecycle_fixture(
    steps: Vec<RetryStep>,
    max_attempts: u32,
) -> (TempDir, WorkerContext, Store, String) {
    let root = tempdir().unwrap();
    let config = project_config(root.path().to_path_buf());
    let worker = config.workers().remove(0);
    let store = Store::open(&config.database_path()).await.unwrap();
    store.register(&worker).await.unwrap();
    let task_id = store
        .create_root(
            "dashboard",
            &worker.id,
            "retry lifecycle",
            "Exercise retry history.",
            "manual",
            None,
        )
        .await
        .unwrap();
    let runner = Arc::new(RetryLifecycleRunner {
        steps: Mutex::new(steps.into()),
        store: store.clone(),
    });
    let (_shutdown, shutdown) = watch::channel(false);
    let ctx = WorkerContext {
        config,
        config_path: None,
        worker,
        store: store.clone(),
        runner,
        gate: Arc::new(Semaphore::new(1)),
        active: Arc::new(AtomicUsize::new(0)),
        budget: Arc::new(AtomicUsize::new(max_attempts as usize)),
        policy: RuntimePolicy {
            max_concurrency: 1,
            max_runs_per_start: max_attempts as usize,
            max_attempts,
            claim_lease_ms: 60_000,
            poll_interval_ms: 25,
        },
        shutdown,
    };
    (root, ctx, store, task_id)
}

async fn process_next(ctx: &WorkerContext) {
    let task = ctx.store.claim(&ctx.worker.id).await.unwrap().unwrap();
    process(ctx, task).await.unwrap();
}

async fn turn_statuses(store: &Store) -> Vec<String> {
    store
        .transcript()
        .await
        .unwrap()
        .into_iter()
        .map(|turn| turn.status)
        .collect()
}

async fn table_count(store: &Store, table: &str) -> i64 {
    let query = match table {
        "turns" => "SELECT COUNT(*) FROM turns",
        "releases" => "SELECT COUNT(*) FROM releases",
        "task_context" => "SELECT COUNT(*) FROM task_context",
        _ => panic!("unsupported table"),
    };
    let (count,): (i64,) = sqlx::query_as(query).fetch_one(&store.pool).await.unwrap();
    count
}
