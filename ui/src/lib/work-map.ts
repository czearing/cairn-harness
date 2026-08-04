import type { QueueItem } from "./types.ts";
import { taskStatusPresentation, type TaskCanonicalStatus } from "./task-status.ts";

export interface WorkMapProgress {
  completed: number;
  total: number;
  active: number;
  blockedOrFailed: number;
}

export interface WorkMapRoot {
  root: QueueItem;
  children: QueueItem[];
  progress: WorkMapProgress;
  health: string[];
}

export interface WorkMap {
  roots: WorkMapRoot[];
  orphans: WorkMapOrphan[];
}

export interface WorkMapOrphan {
  item: QueueItem;
  reason: "missing-parent" | "cycle";
}

export interface AgentAssignmentSummary {
  activeCount: number;
  current?: QueueItem;
}

export function assembleWorkMap(roots: QueueItem[], children: QueueItem[]): WorkMap {
  const byParent = new Map<string, QueueItem[]>();
  const rootIds = new Set(roots.map((root) => root.id));
  const childrenById = new Map(children.map((child) => [child.id, child]));
  const orphans: WorkMapOrphan[] = [];
  for (const child of children) {
    const resolution = resolveRoot(child, rootIds, childrenById);
    if (!resolution.rootId) {
      orphans.push({ item: child, reason: resolution.reason });
      continue;
    }
    const siblings = byParent.get(resolution.rootId) || [];
    siblings.push(child);
    byParent.set(resolution.rootId, siblings);
  }
  const projectedRoots = roots.map((root) => {
    const rootChildren = sortAssignments(byParent.get(root.id) || []);
    return {
      root,
      children: rootChildren,
      progress: progressFor(rootChildren),
      health: planHealth(root, rootChildren),
    };
  });
  return {
    roots: projectedRoots,
    orphans: [...orphans].sort((left, right) =>
      compareAssignments(left.item, right.item)),
  };
}

export function planHealth(root: QueueItem, children: QueueItem[]): string[] {
  const reasons: string[] = [];
  const rootStatus = canonicalStatus(root);
  const leaves = leafChildren(children);
  const nonCancelledLeaves = leaves.filter((child) => canonicalStatus(child) !== "cancelled");
  const unassigned = children.filter((child) => !child.executorId && !child.agentId);
  if (unassigned.length) {
    reasons.push(`${unassigned.length} ${plural(unassigned.length, "child is", "children are")} unassigned.`);
  }
  if (rootStatus === "completed") {
    const incomplete = nonCancelledLeaves.filter((child) => canonicalStatus(child) !== "completed");
    if (incomplete.length) {
      const failed = incomplete.filter((child) => canonicalStatus(child) === "failed").length;
      reasons.push(`Completed root has ${incomplete.length} incomplete ${plural(incomplete.length, "child", "children")}${failed ? `, including ${failed} failed` : ""}.`);
    }
  }
  if (rootStatus === "running" && nonCancelledLeaves.length
    && nonCancelledLeaves.every((child) => ["queued", "waiting"].includes(canonicalStatus(child)))) {
    reasons.push("Root is running while every delegated task is queued or waiting.");
  }
  return reasons;
}

export function summarizeAgentAssignments(items: QueueItem[]): AgentAssignmentSummary {
  const candidates = sortAssignments(items.filter((item) => !["completed", "cancelled"].includes(canonicalStatus(item))));
  return {
    activeCount: candidates.filter((item) => taskPresentation(item).active).length,
    current: candidates[0],
  };
}

export function workMapRootIsHistorical(entry: WorkMapRoot) {
  return ["completed", "cancelled"].includes(canonicalStatus(entry.root)) && entry.health.length === 0;
}

export function workMapChildIsHistorical(item: QueueItem) {
  return ["completed", "cancelled"].includes(canonicalStatus(item));
}

export function workMapOrphanIsHistorical(item: QueueItem) {
  return taskPresentation(item).terminal;
}

export function taskPresentation(item: QueueItem) {
  return item.canonicalStatus && item.statusLabel
    ? {
      ...taskStatusPresentation(item.status),
      canonical: item.canonicalStatus,
      label: item.statusLabel,
    }
    : taskStatusPresentation(item.status);
}

export function relativeTaskTime(value?: string, now = Date.now()) {
  if (!value) return "Update time unavailable";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Update time unavailable";
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

function progressFor(children: QueueItem[]): WorkMapProgress {
  const included = leafChildren(children).filter((child) => canonicalStatus(child) !== "cancelled");
  return {
    completed: included.filter((child) => canonicalStatus(child) === "completed").length,
    total: included.length,
    active: included.filter((child) => taskPresentation(child).active).length,
    blockedOrFailed: included.filter((child) => ["blocked", "failed"].includes(canonicalStatus(child))).length,
  };
}

function leafChildren(children: QueueItem[]) {
  const parents = new Set(children.map((child) => child.parentId).filter((id): id is string => Boolean(id)));
  return children.filter((child) => !parents.has(child.id));
}

function resolveRoot(child: QueueItem, roots: Set<string>, children: Map<string, QueueItem>) {
  const visited = new Set([child.id]);
  let parentId = child.parentId;
  while (parentId) {
    if (roots.has(parentId)) return { rootId: parentId, reason: "missing-parent" as const };
    if (visited.has(parentId)) return { reason: "cycle" as const };
    visited.add(parentId);
    const parent = children.get(parentId);
    if (!parent) return { reason: "missing-parent" as const };
    parentId = parent.parentId;
  }
  return { reason: "missing-parent" as const };
}

function sortAssignments(items: QueueItem[]) {
  return [...items].sort(compareAssignments);
}

function compareAssignments(left: QueueItem, right: QueueItem) {
  const priority = statusPriority(canonicalStatus(left)) - statusPriority(canonicalStatus(right));
  if (priority) return priority;
  const recency = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  return recency || left.id.localeCompare(right.id);
}

function canonicalStatus(item: QueueItem): TaskCanonicalStatus {
  return item.canonicalStatus || taskStatusPresentation(item.status).canonical;
}

function statusPriority(status: TaskCanonicalStatus) {
  return {
    running: 0,
    blocked: 1,
    failed: 2,
    waiting: 3,
    queued: 4,
    paused: 5,
    unknown: 6,
    completed: 7,
    cancelled: 8,
  }[status];
}

function plural(count: number, singular: string, pluralValue: string) {
  return count === 1 ? singular : pluralValue;
}
