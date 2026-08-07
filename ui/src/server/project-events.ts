import { watch, type FSWatcher } from "node:fs";
import type { Project } from "@/lib/types";
import { conversationVersions } from "./project-conversation-versions";
import { isDatabase, isRelevantProjectEvent, projectEventAgent } from "./project-event-path";

export interface ProjectEvent { projectId: string; conversations: string[]; }
export const PROJECT_EVENT_COALESCE_MS = 150;
type Listener = (event: ProjectEvent) => void;
type DegradedListener = () => void;
const state = globalThis as typeof globalThis & { harnessEvents?: EventState };
interface EventState {
  subscriptions: Map<Listener, Map<string, Project>>;
  degradedListeners: Map<Listener, DegradedListener>;
  watchers: Map<string, FSWatcher>;
  projects: Map<string, Project>;
  queued: Map<string, ProjectEvent>;
  versions: Map<string, Map<string, string>>;
}
interface EventDependencies {
  watchProject: (root: string, listener: (event: string, file: string | Buffer | null) => void) => FSWatcher;
  conversationVersions: (project: Project) => Map<string, string>;
  schedule?: (callback: () => void) => void;
}

function eventState() {
  const current = state.harnessEvents ||= createEventState();
  current.subscriptions ||= new Map();
  current.degradedListeners ||= new Map();
  current.projects ||= new Map();
  return current;
}

export function subscribeToProjectEvents(
  projects: Project[],
  listener: Listener,
  onDegraded: DegradedListener = () => {},
) {
  return subscribe(eventState(), projects, listener, onDegraded, defaultDependencies);
}

export function createProjectEventSubscriber(dependencies: EventDependencies) {
  const current = createEventState();
  return (projects: Project[], listener: Listener, onDegraded: DegradedListener = () => {}) =>
    subscribe(current, projects, listener, onDegraded, dependencies);
}

const defaultDependencies: EventDependencies = {
  watchProject: (root, listener) => watch(root, { recursive: true }, listener),
  conversationVersions,
  // A single SQLite commit emits a burst of WAL events. Without a real-time window each burst
  // becomes another client refetch, and every refetch re-reads the project synchronously.
  schedule: (callback) => setTimeout(callback, PROJECT_EVENT_COALESCE_MS).unref?.(),
};

function createEventState(): EventState {
  return {
    subscriptions: new Map(),
    degradedListeners: new Map(),
    watchers: new Map(),
    projects: new Map(),
    queued: new Map(),
    versions: new Map(),
  };
}

function subscribe(
  current: EventState,
  projects: Project[],
  listener: Listener,
  onDegraded: DegradedListener,
  dependencies: EventDependencies,
) {
  const ownedProjects = new Map(projects.map((project) => [project.root, project]));
  const previousProjects = current.subscriptions.get(listener);
  current.subscriptions.delete(listener);
  current.subscriptions.set(listener, ownedProjects);
  current.degradedListeners.set(listener, onDegraded);
  for (const project of projects) {
    const root = project.root;
    current.projects.set(root, project);
    reconcileVersions(current, project, dependencies.conversationVersions(project));
    if (current.watchers.has(root)) continue;
    try {
      const watcher = dependencies.watchProject(root, (_event, file) => {
        const latest = current.projects.get(root);
        if (!latest) return;
        const changed = String(file || "");
        if (isRelevantProjectEvent(changed, latest.workDir)) emit(current, latest, changed, dependencies);
      });
      current.watchers.set(root, watcher);
      watcher.on?.("error", () => watcherFailed(current, root, watcher));
    } catch {
      onDegraded();
    }
  }
  for (const root of previousProjects?.keys() || []) {
    if (!ownedProjects.has(root)) reconcileRoot(current, root, dependencies);
  }
  pruneInactiveRoots(current);

  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    if (current.subscriptions.get(listener) !== ownedProjects) return;
    current.subscriptions.delete(listener);
    current.degradedListeners.delete(listener);
    for (const root of ownedProjects.keys()) reconcileRoot(current, root, dependencies);
    pruneInactiveRoots(current);
  };
}

function watcherFailed(current: EventState, root: string, watcher: FSWatcher) {
  if (current.watchers.get(root) !== watcher) return;
  watcher.close();
  current.watchers.delete(root);
  for (const [listener, projects] of current.subscriptions) {
    if (projects.has(root)) current.degradedListeners.get(listener)?.();
  }
}

function reconcileRoot(current: EventState, root: string, dependencies: EventDependencies) {
  let activeProject: Project | undefined;
  for (const projects of current.subscriptions.values()) activeProject = projects.get(root) || activeProject;
  if (!activeProject) {
    releaseRoot(current, root);
    return;
  }
  current.projects.set(root, activeProject);
  reconcileVersions(current, activeProject, dependencies.conversationVersions(activeProject));
}

function pruneInactiveRoots(current: EventState) {
  const activeRoots = new Set([...current.subscriptions.values()].flatMap((projects) => [...projects.keys()]));
  const storedRoots = new Set([
    ...current.watchers.keys(),
    ...current.projects.keys(),
    ...current.queued.keys(),
    ...current.versions.keys(),
  ]);
  for (const root of storedRoots) if (!activeRoots.has(root)) releaseRoot(current, root);
}

function releaseRoot(current: EventState, root: string) {
  current.watchers.get(root)?.close();
  current.watchers.delete(root);
  current.projects.delete(root);
  current.queued.delete(root);
  current.versions.delete(root);
}

function reconcileVersions(current: EventState, project: Project, latest: Map<string, string>) {
  const previous = current.versions.get(project.root);
  if (!previous) {
    current.versions.set(project.root, latest);
    return;
  }
  const agents = new Set(project.agents.map((agent) => agent.id));
  for (const agent of previous.keys()) if (!agents.has(agent)) previous.delete(agent);
  for (const [agent, version] of latest) if (!previous.has(agent)) previous.set(agent, version);
}

function emit(
  current: EventState,
  project: Project,
  file: string,
  dependencies: EventDependencies,
) {
  const readVersions = dependencies.conversationVersions;
  const schedule = dependencies.schedule || queueMicrotask;
  const normalized = file.replaceAll("\\", "/");
  const database = isDatabase(normalized);
  const eventAgent = projectEventAgent(normalized, project);
  const previous = current.versions.get(project.root) || new Map();
  const next = database ? readVersions(project) : previous;
  const conversations = eventAgent
    ? [eventAgent]
    : database
    ? [...next].filter(([agent, version]) => previous.get(agent) !== version).map(([agent]) => agent)
    : [];
  current.versions.set(project.root, next);
  const queued = current.queued.get(project.root);
  if (queued) {
    queued.projectId = project.id;
    queued.conversations = [...new Set([...queued.conversations, ...conversations])];
    return;
  }
  const event = { projectId: project.id, conversations };
  current.queued.set(project.root, event);
  schedule(() => {
    if (current.queued.get(project.root) !== event) return;
    current.queued.delete(project.root);
    for (const listener of current.subscriptions.keys()) listener(event);
  });
}
