import type { DatabaseSync } from "node:sqlite";

export interface DashboardRoot {
  id: string;
  assignee: string;
  topic: string;
  body: string;
  createdAt: string;
}

// Assignee matches the leader itself, or any agent replicating the leader's role template, so
// the shared capacity limit and routing stay correct however many replicas the leader currently
// has (zero or more) instead of only counting/targeting the literal leader name. Every use site
// binds the leader value twice: once for the exact match, once for the role_template match.
export const manualLeaderWorkItemRoot = `kind='root' AND source='manual' AND parent_id IS NULL
  AND topic='work-item' AND assignee IN (
    SELECT ? AS agent_id
    UNION
    SELECT agent_id FROM agent_replica_profiles WHERE replica_eligible=1 AND role_template=?
  )`;
const activeManualRoots = `${manualLeaderWorkItemRoot}
  AND status IN ('pending','claimed','waiting','deferred')`;
const backloggedManualRoots = `${manualLeaderWorkItemRoot} AND status='backlog'`;

// Reuses the same idle/least-busy replica selection as the harness's own delegation routing, so
// a manual work item filed for the leader lands directly on whichever pool member (the leader
// itself when it has no configured replicas) is idlest right now, without a delegation hop.
export function resolveReplicaAssignee(db: DatabaseSync, requested: string): string {
  const template = db.prepare(
    "SELECT 1 FROM agent_replica_profiles WHERE role_template=? AND replica_eligible=1",
  ).get(requested);
  if (!template) return requested;
  const candidates = db.prepare(`
    SELECT profile.agent_id AS agentId FROM agent_replica_profiles profile
    JOIN agents agent ON agent.agent_id=profile.agent_id
    WHERE profile.role_template=? AND profile.replica_eligible=1 AND agent.status!='paused'
    ORDER BY CASE
      WHEN agent.status='idle' AND NOT EXISTS(
        SELECT 1 FROM tasks active WHERE active.assignee=profile.agent_id
        AND active.status IN ('pending','claimed','waiting','deferred')
      ) THEN 0 ELSE 1 END,
      (SELECT COUNT(*) FROM tasks active WHERE active.assignee=profile.agent_id
       AND active.status IN ('pending','claimed','waiting','deferred','buffered')),
      profile.agent_id
  `).all(requested) as { agentId: string }[];
  return candidates[0]?.agentId ?? requested;
}

export function configureManualRootCapacity(db: DatabaseSync, leader: string, limit?: number) {
  ensureCapacityPolicy(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE root_task_policy SET max_active_tasks=?,leader=? WHERE singleton=1")
      .run(limit || 0, leader);
    db.prepare(`UPDATE tasks SET status='pending' WHERE kind='root' AND source='manual'
      AND parent_id IS NULL AND topic='work-item' AND status='backlog'
      AND NOT (${manualLeaderWorkItemRoot})`).run(leader, leader);
    if (limit) {
      const { active } = db.prepare(`SELECT COUNT(*) active FROM tasks WHERE ${activeManualRoots}`)
        .get(leader, leader) as { active: number };
      const excess = Math.max(0, active - limit);
      if (excess) {
        db.prepare(`UPDATE tasks SET status='backlog' WHERE id IN (
          SELECT id FROM tasks WHERE ${manualLeaderWorkItemRoot} AND status='pending'
          ORDER BY created_at DESC,id DESC LIMIT ?
        )`).run(leader, leader, excess);
      }
    }
    promoteManualRootBacklog(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function admitDashboardRoot(db: DatabaseSync, task: DashboardRoot) {
  ensureCapacityPolicy(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const { max_active_tasks: limit, leader } = db.prepare(
      "SELECT max_active_tasks,leader FROM root_task_policy WHERE singleton=1",
    ).get() as { max_active_tasks: number; leader: string };
    const capacityEligible = task.topic === "work-item" && task.assignee === leader;
    const assignee = capacityEligible ? resolveReplicaAssignee(db, task.assignee) : task.assignee;
    const { active } = db.prepare(`SELECT COUNT(*) active FROM tasks WHERE ${activeManualRoots}`)
      .get(leader, leader) as { active: number };
    const status = capacityEligible && limit > 0 && active >= limit ? "backlog" : "pending";
    const result = db.prepare(`INSERT INTO tasks(
      id,parent_id,kind,source,creator,assignee,topic,body,status,created_at)
      VALUES(?,NULL,'root','manual','dashboard',?,?,?,?,?)
      ON CONFLICT(id) DO NOTHING`)
      .run(task.id, assignee, task.topic, task.body, status, task.createdAt);
    db.exec("COMMIT");
    return { created: result.changes === 1, status };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function promoteManualRootBacklog(db: DatabaseSync) {
  const policy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='root_task_policy'").get();
  if (!policy) return 0;
  ensureCapacityPolicy(db);
  const { max_active_tasks: limit, leader } = db.prepare(
    "SELECT max_active_tasks,leader FROM root_task_policy WHERE singleton=1",
  ).get() as { max_active_tasks: number; leader: string };
  if (!limit) {
    return Number(db.prepare(`UPDATE tasks SET status='pending' WHERE ${backloggedManualRoots}`).run(leader, leader).changes);
  }
  const { active } = db.prepare(`SELECT COUNT(*) active FROM tasks WHERE ${activeManualRoots}`)
    .get(leader, leader) as { active: number };
  const available = Math.max(0, limit - active);
  if (!available) return 0;
  return Number(db.prepare(`UPDATE tasks SET status='pending' WHERE id IN (
    SELECT id FROM tasks WHERE ${backloggedManualRoots}
    ORDER BY created_at,id LIMIT ?
  )`).run(leader, leader, available).changes);
}

function ensureCapacityPolicy(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS root_task_policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    max_active_tasks INTEGER NOT NULL,
    leader TEXT NOT NULL DEFAULT ''
  )`);
  const columns = db.prepare("PRAGMA table_info(root_task_policy)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "leader")) {
    db.exec("ALTER TABLE root_task_policy ADD COLUMN leader TEXT NOT NULL DEFAULT ''");
  }
  db.prepare("INSERT OR IGNORE INTO root_task_policy(singleton,max_active_tasks) VALUES(1,0)").run();
}
