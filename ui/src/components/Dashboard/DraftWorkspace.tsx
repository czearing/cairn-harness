"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, QueueItem } from "@/lib/types";
import { useStoredRecord } from "@/lib/use-stored-record";
import type { TaskEditorHandle } from "../TaskEditor/TaskEditor";
import { newDraft } from "./dashboard-data";
import { postJson, type PostJsonResult, writeJson } from "./dashboard-requests";
import { moveDraftTab, resetSoleSubmittedDraft, updateDraftContentSnapshot } from "./draft-workspace-order";
import { DRAFT_HEIGHTS_COOKIE_KEY, DRAFT_WORKSPACE_STORAGE_KEY, parseDraftHeights, restoreDraftWorkspace } from "./draft-workspace-storage";
import { DraftWorkspace, DraftWorkspacePlaceholder, editorKey, emptyDraftButtonId, focusDraft, tabId, type DraftWorkspaceState } from "./DraftWorkspaceView";

interface HookOptions {
  project?: Project;
  initialHeight?: number;
  activeDraftId?: string;
  onDraftRoute?: (projectId: string, draftId?: string, replace?: boolean) => void;
  onSubmitted: (result: PostJsonResult) => void;
}
function readCookie(name: string) {
  const prefix = `${name}=`;
  const value = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}
function readStoredWorkspace(projectId: string, fallback?: string) {
  try {
    const records = JSON.parse(localStorage.getItem(DRAFT_WORKSPACE_STORAGE_KEY) || "{}") as Record<string, unknown>;
    return typeof records[projectId] === "string" ? records[projectId] : fallback;
  } catch {
    return fallback;
  }
}
export function useDraftWorkspaces({ project, initialHeight, activeDraftId, onDraftRoute, onSubmitted }: HookOptions) {
  const [workspaces, setWorkspaces] = useState<Record<string, DraftWorkspaceState>>({});
  const workspacesRef = useRef(workspaces);
  const editors = useRef(new Map<string, TaskEditorHandle>());
  const initialized = useRef(new Set<string>());
  const pendingRestore = useRef(new Map<string, DraftWorkspaceState>());
  const appliedDraftRoute = useRef("");
  const createdStatusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [successDraftId, setSuccessDraftId] = useState<string>();
  const [keyboardFocusDraftId, setKeyboardFocusDraftId] = useState<string>();
  const [stored, setStored] = useStoredRecord(DRAFT_WORKSPACE_STORAGE_KEY);
  const workspace = project ? workspaces[project.id] : undefined;
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);
  useEffect(() => () => clearTimeout(createdStatusTimer.current), []);
  useEffect(() => {
    if (!project || initialized.current.has(project.id)) return;
    initialized.current.add(project.id);
    const restored = restoreDraftWorkspace(project, readStoredWorkspace(project.id, stored[project.id]), initialHeight);
    pendingRestore.current.set(project.id, restored);
    setWorkspaces((current) => ({ ...current, [project.id]: restored }));
  }, [initialHeight, project, stored]);
  useEffect(() => {
    if (!project || !workspace) return;
    const routeKey = `${project.id}:${activeDraftId || ""}`;
    if (appliedDraftRoute.current === routeKey) return;
    appliedDraftRoute.current = routeKey;
    if (!activeDraftId || workspace.activeId === activeDraftId) return;
    const existing = workspace.tabs.find((tab) => tab.item.id === activeDraftId);
    const persisted = project.drafts?.find((draft) => draft.id === activeDraftId);
    if (!existing && !persisted) {
      onDraftRoute?.(project.id, undefined, true);
      return;
    }
    update(project.id, (current) => existing
      ? { ...current, activeId: activeDraftId }
      : { ...current, tabs: [...current.tabs, { item: persisted!, persisted: true }], activeId: activeDraftId });
  }, [activeDraftId, onDraftRoute, project, workspace]);

  useEffect(() => {
    if (!project || !initialized.current.has(project.id) || !workspace) return;
    const pending = pendingRestore.current.get(project.id);
    if (pending && workspace !== pending) return;
    if (pending === workspace) pendingRestore.current.delete(project.id);
    const value = JSON.stringify({
      openIds: workspace.tabs.filter((tab) => tab.persisted).map((tab) => tab.item.id),
      activeId: workspace.tabs.find((tab) => tab.item.id === workspace.activeId)?.persisted
        ? workspace.activeId
        : undefined,
      height: workspace.height,
    });
    if (value !== stored[project.id]) setStored({ ...stored, [project.id]: value });
    if (typeof workspace.height === "number") {
      const heights = parseDraftHeights(readCookie(DRAFT_HEIGHTS_COOKIE_KEY));
      document.cookie = `${DRAFT_HEIGHTS_COOKIE_KEY}=${encodeURIComponent(JSON.stringify({ ...heights, [project.id]: workspace.height }))}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  }, [project, setStored, stored, workspace]);

  function update(projectId: string, change: (current: DraftWorkspaceState) => DraftWorkspaceState) {
    setWorkspaces((current) => {
      const next = {
        ...current,
        [projectId]: change(current[projectId] || { tabs: [] }),
      };
      workspacesRef.current = next;
      return next;
    });
  }

  function open(projectId: string, item: QueueItem, persisted = true, keyboardFocus = false) {
    update(projectId, (current) => current.tabs.some((tab) => tab.item.id === item.id)
      ? { ...current, activeId: item.id }
      : { tabs: [...current.tabs, { item, persisted }], activeId: item.id });
    focusDraft(projectId, item.id);
    setKeyboardFocusDraftId(keyboardFocus ? item.id : undefined);
    if (persisted) onDraftRoute?.(projectId, item.id);
  }
  function create(keyboardFocus = false) {
    if (!project) return;
    const current = workspacesRef.current[project.id];
    const blank = current?.tabs.find((tab) => !tab.persisted && !tab.item.content?.trim());
    if (blank) {
      update(project.id, (workspace) => ({ ...workspace, activeId: blank.item.id }));
      focusDraft(project.id, blank.item.id);
      return;
    }
    open(project.id, newDraft(), false, keyboardFocus);
  }
  function close(projectId: string, draftId: string) {
    editors.current.delete(editorKey(projectId, draftId));
    const current = workspacesRef.current[projectId] || { tabs: [] };
    const index = current.tabs.findIndex((tab) => tab.item.id === draftId);
    if (index < 0) return;
    const tabs = current.tabs.filter((tab) => tab.item.id !== draftId);
    const activeId = current.activeId === draftId
      ? tabs[index]?.item.id || tabs[index - 1]?.item.id
      : current.activeId;
    update(projectId, () => ({ ...current, tabs, activeId }));
    if (activeDraftId === draftId) {
      const activeTab = tabs.find((tab) => tab.item.id === activeId);
      onDraftRoute?.(projectId, activeTab?.persisted ? activeId : undefined, true);
    }
    requestAnimationFrame(() => {
      if (activeId) document.getElementById(tabId(projectId, activeId))?.focus();
      else document.getElementById(emptyDraftButtonId(projectId))?.focus();
    });
  }
  async function requestClose(projectId: string, draftId: string) {
    const current = workspacesRef.current[projectId] || { tabs: [] };
    const tab = current.tabs.find((candidate) => candidate.item.id === draftId);
    if (!tab) return false;
    const blankNeverPersisted = !tab.persisted && !tab.item.content?.trim();
    if (!blankNeverPersisted) {
      const saved = await editors.current.get(editorKey(projectId, draftId))?.saveLatest();
      if (saved === false) {
        update(projectId, (workspace) => ({ ...workspace, activeId: draftId }));
        focusDraft(projectId, draftId);
        return false;
      }
    }
    close(projectId, draftId);
    return true;
  }
  function abandon(projectId: string, draftId: string) {
    close(projectId, draftId);
  }
  async function discard(projectId: string, draftId: string) {
    try {
      await writeJson(`/api/projects/${projectId}/draft?id=${encodeURIComponent(draftId)}`, "DELETE");
      close(projectId, draftId);
      return true;
    } catch {
      update(projectId, (workspace) => ({ ...workspace, activeId: draftId }));
      focusDraft(projectId, draftId);
      return false;
    }
  }
  async function save(projectId: string, draftId: string, body: string) {
    await writeJson(`/api/projects/${projectId}/draft`, "PUT", { id: draftId, body });
    update(projectId, (current) => ({
      ...current,
      tabs: current.tabs.map((tab) => tab.item.id === draftId
        ? { item: { ...tab.item, content: body }, persisted: Boolean(body.trim()) }
        : tab),
    }));
  }
  async function send(projectId: string, draftId: string, body: string) {
    const result = await postJson(`/api/projects/${projectId}/draft/submit`, { id: draftId, body });
    onSubmitted(result);
    const current = workspacesRef.current[projectId] || { tabs: [] };
    const replacement = newDraft();
    const resetWorkspace = resetSoleSubmittedDraft(current, draftId, replacement);
    if (resetWorkspace) {
      const keyboardFocus = document.activeElement?.matches(":focus-visible") ?? false;
      update(projectId, () => resetWorkspace);
      setSuccessDraftId(replacement.id);
      clearTimeout(createdStatusTimer.current);
      createdStatusTimer.current = setTimeout(() => setSuccessDraftId((currentId) => currentId === replacement.id ? undefined : currentId), 1400);
      focusDraft(projectId, replacement.id);
      setKeyboardFocusDraftId(keyboardFocus ? replacement.id : undefined);
      return;
    }
    close(projectId, draftId);
  }
  function change(projectId: string, draftId: string, body: string) {
    const workspace = workspacesRef.current[projectId];
    if (!workspace) return;
    workspacesRef.current = {
      ...workspacesRef.current,
      [projectId]: updateDraftContentSnapshot(workspace, draftId, body),
    };
  }
  async function saveAll() {
    if (!project || !workspace) return true;
    for (const tab of workspace.tabs) {
      const saved = await editors.current.get(editorKey(project.id, tab.item.id))?.saveLatest();
      if (saved === false) {
        update(project.id, (current) => ({ ...current, activeId: tab.item.id }));
        return false;
      }
    }
    return true;
  }

  return {
    workspace,
    placeholder: project ? <DraftWorkspacePlaceholder expanded={Boolean(project.drafts?.length)} height={initialHeight} /> : null,
    create,
    open,
    saveAll,
    view: project && workspace ? <DraftWorkspace
      projectId={project.id}
      workspace={workspace}
      onActive={(activeId) => {
        update(project.id, (current) => ({ ...current, activeId }));
      }}
      onReorder={(sourceId, targetId) => update(project.id, (current) => {
        const tabs = moveDraftTab(current.tabs, sourceId, targetId);
        return tabs === current.tabs ? current : { ...current, tabs };
      })}
      onHeight={(height) => update(project.id, (current) => ({ ...current, height }))}
      onClose={requestClose}
      onAbandon={abandon}
      onDiscard={discard}
      onRegister={(draftId, handle) => {
        const key = editorKey(project.id, draftId);
        if (handle) editors.current.set(key, handle);
        else editors.current.delete(key);
      }}
      onSave={save}
      onChange={change}
      onSend={send}
      onNew={create}
      successDraftId={successDraftId}
      keyboardFocusDraftId={keyboardFocusDraftId}
      onPointerFocus={(draftId) => setKeyboardFocusDraftId((current) => current === draftId ? undefined : current)}
    /> : null,
  };
}
