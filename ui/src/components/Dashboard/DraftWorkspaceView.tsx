import { Button } from "@/components/Button/Button";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Plus, X } from "lucide-react";
import type { QueueItem } from "@/lib/types";
import { DashboardPane } from "../DashboardPane/DashboardPane";
import { Modal } from "../Modal/Modal";
import { ResizeHandle } from "../ResizeHandle/ResizeHandle";
import { TaskEditor, type TaskEditorHandle, type TaskEditorState } from "../TaskEditor/TaskEditor";
import styles from "./Dashboard.module.css";

const defaultWorkbenchHeight = 360;
const minimumWorkbenchHeight = 220;
const maximumWorkbenchHeight = 720;

function viewportMaximumHeight() {
  const ratio = window.matchMedia("(max-width: 720px)").matches ? .7 : .75;
  return Math.max(1, Math.min(maximumWorkbenchHeight, Math.round(window.innerHeight * ratio)));
}

function clampWorkbenchHeight(next: number, maximum: number) {
  return Math.min(maximum, Math.max(Math.min(minimumWorkbenchHeight, maximum), next));
}

export interface DraftTab {
  item: QueueItem;
  persisted: boolean;
}
const emptyTabs: DraftTab[] = [];

export interface DraftWorkspaceState {
  tabs: DraftTab[];
  activeId?: string;
  height?: number;
}

export function DraftWorkspacePlaceholder({ expanded, height = defaultWorkbenchHeight }: { expanded: boolean; height?: number }) {
  const style = { "--draft-workbench-height": `${height}px` } as CSSProperties;
  return <><div className={styles.draftWorkspace} data-empty={!expanded || undefined} style={style} aria-hidden="true" />
    <div className={styles.draftWorkspaceSpacer} data-draft-workbench-spacer data-empty={!expanded || undefined} aria-hidden="true" style={style} /></>;
}

interface Props {
  projectId: string;
  workspace?: DraftWorkspaceState;
  onActive: (draftId: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  onHeight: (height: number) => void;
  onClose: (projectId: string, draftId: string) => Promise<boolean>;
  onAbandon: (projectId: string, draftId: string) => void;
  onDiscard: (projectId: string, draftId: string) => Promise<boolean>;
  onRegister: (draftId: string, handle: TaskEditorHandle | null) => void;
  onSave: (projectId: string, draftId: string, body: string) => Promise<void>;
  onChange: (projectId: string, draftId: string, body: string) => void;
  onSend: (projectId: string, draftId: string, body: string) => Promise<void>;
  onNew: (keyboardFocus?: boolean) => void;
  successDraftId?: string;
  keyboardFocusDraftId?: string;
  onPointerFocus: (draftId: string) => void;
}

export function DraftWorkspace({ projectId, workspace, onActive, onReorder, onHeight, onClose, onAbandon, onDiscard, onRegister, onSave, onChange, onSend, onNew, successDraftId, keyboardFocusDraftId, onPointerFocus }: Props) {
  const tabs = workspace?.tabs ?? emptyTabs;
  const hasTabs = tabs.length > 0;
  const [height, setHeight] = useState(workspace?.height || defaultWorkbenchHeight);
  const [maximumHeight, setMaximumHeight] = useState(maximumWorkbenchHeight);
  const [editorStates, setEditorStates] = useState<Record<string, TaskEditorState>>({});
  const [dialog, setDialog] = useState<{ kind: "unsaved" | "closeError"; draftId: string }>();
  const [discarding, setDiscarding] = useState(false);
  const [hoveredDraftId, setHoveredDraftId] = useState<string>();
  const draggedDraft = useRef<string | undefined>(undefined);
  const tabNodes = useRef(new Map<string, HTMLButtonElement>());
  const closeNodes = useRef(new Map<string, HTMLButtonElement>());
  const onHeightRef = useRef(onHeight);
  const workbenchStyle = { "--draft-workbench-height": `${height}px` } as CSSProperties;
  useEffect(() => {
    onHeightRef.current = onHeight;
  }, [onHeight]);
  useEffect(() => {
    onHeightRef.current(height);
  }, [height]);
  function changeHeight(next: number | ((current: number) => number)) {
    setHeight((current) => typeof next === "function" ? next(current) : next);
  }
  useEffect(() => {
    function updateViewportHeight() {
      const maximum = viewportMaximumHeight();
      setMaximumHeight(maximum);
      if (hasTabs) setHeight((current) => clampWorkbenchHeight(current, maximum));
    }
    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    return () => window.removeEventListener("resize", updateViewportHeight);
  }, [hasTabs]);
  useEffect(() => {
    function finishDrag(event: PointerEvent) {
      const sourceId = draggedDraft.current;
      const targetId = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-draft-tab-id]")
        ?.dataset.draftTabId;
      if (sourceId && targetId && sourceId !== targetId) onReorder(sourceId, targetId);
      draggedDraft.current = undefined;
    }
    function cancelDrag() {
      draggedDraft.current = undefined;
    }
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [onReorder]);
  useEffect(() => {
    if (!workspace?.activeId) return;
    document.getElementById(tabId(projectId, workspace.activeId))
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [projectId, workspace?.activeId]);
  useLayoutEffect(() => {
    const syncClosePositions = () => {
      for (const tab of tabs) {
        const tabNode = tabNodes.current.get(tab.item.id);
        const closeNode = closeNodes.current.get(tab.item.id);
        if (!tabNode || !closeNode) continue;
        closeNode.style.left = `${tabNode.offsetLeft + tabNode.offsetWidth - 36}px`;
        closeNode.style.height = `${tabNode.offsetHeight}px`;
      }
    };
    syncClosePositions();
    const observer = new ResizeObserver(syncClosePositions);
    for (const tab of tabs) {
      const node = tabNodes.current.get(tab.item.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [tabs]);
  function activateByKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Delete") {
      event.preventDefault();
      requestClose(tabs[index].item.id);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const nextId = tabs[nextIndex]?.item.id;
    if (!nextId) return;
    onActive(nextId);
    requestAnimationFrame(() => document.getElementById(tabId(projectId, nextId))?.focus());
  }
  function requestClose(draftId: string) {
    const tab = tabs.find((candidate) => candidate.item.id === draftId);
    if (!tab) return;
    if (tab.persisted) {
      void closeSavedDraft(draftId);
      return;
    }
    if (editorStates[draftId]?.dirty) {
      setDialog({ kind: "unsaved", draftId });
      return;
    }
    void onClose(projectId, draftId);
  }
  async function closeSavedDraft(draftId: string) {
    setDiscarding(true);
    const closed = await onDiscard(projectId, draftId);
    setDiscarding(false);
    if (!closed) setDialog({ kind: "closeError", draftId });
  }
  function newDraftShortcut(event: React.KeyboardEvent<HTMLElement>) {
    if (
      event.defaultPrevented
      || event.repeat
      || event.nativeEvent.isComposing
      || event.key.toLowerCase() !== "n"
      || !(event.ctrlKey || event.metaKey)
      || event.altKey
      || event.shiftKey
      || hasOpenPopup()
    ) {
      return;
    }
    event.preventDefault();
    onNew(true);
  }
  return <><DashboardPane
    as="section"
    id={draftWorkspaceId(projectId)}
    className={styles.draftWorkspace}
    aria-label="Draft workbench"
    tone="workspace"
    data-draft-workbench
    data-empty={!hasTabs || undefined}
    style={workbenchStyle}
    onKeyDownCapture={newDraftShortcut}
  >
    {hasTabs && <ResizeHandle
      className={styles.draftResizeHandle}
      orientation="horizontal"
      direction={-1}
      label="Resize draft workbench"
      controls={draftWorkspaceId(projectId)}
      value={height}
      min={Math.min(minimumWorkbenchHeight, maximumHeight)}
      max={maximumHeight}
      defaultValue={defaultWorkbenchHeight}
      onPreview={(value) => changeHeight(clampWorkbenchHeight(value, maximumHeight))}
      onCommit={(value) => changeHeight(clampWorkbenchHeight(value, maximumHeight))}
      onCancel={(value) => changeHeight(clampWorkbenchHeight(value, maximumHeight))}
    />}
    <div className={styles.draftTabRow}>
      {hasTabs ? <>
        <div className={styles.draftTabsViewport}>
          <div className={styles.draftTabs} role="tablist" aria-label="Task drafts">
            {tabs.map((tab, index) => {
              const active = workspace?.activeId === tab.item.id;
              const label = draftLabel(tab.item.content);
              const state = editorStates[tab.item.id];
              return <Button
                variant="inherit"
                ref={(node) => {
                  if (node) tabNodes.current.set(tab.item.id, node);
                  else tabNodes.current.delete(tab.item.id);
                }}
                key={editorKey(projectId, tab.item.id)}
                id={tabId(projectId, tab.item.id)}
                type="button"
                className={styles.draftTab}
                role="tab"
                aria-selected={active}
                aria-controls={panelId(projectId, tab.item.id)}
                data-draft-tab-id={tab.item.id}
                tabIndex={active ? 0 : -1}
                onClick={() => onActive(tab.item.id)}
                onKeyDown={(event) => activateByKeyboard(event, index)}
                onPointerDown={() => { draggedDraft.current = tab.item.id; }}
                onPointerEnter={() => setHoveredDraftId(tab.item.id)}
                onPointerLeave={() => setHoveredDraftId((current) => current === tab.item.id ? undefined : current)}
              >
                <span className={styles.draftLabel}>{label}</span>
                {!active && state?.error && <span className={styles.tabError} aria-label="Save error" />}
              </Button>;
            })}
          </div>
          <div className={styles.draftCloseLayer}>
            {tabs.map((tab) => {
              const active = workspace?.activeId === tab.item.id;
              const label = draftLabel(tab.item.content);
              return <Button
                variant="inherit"
                ref={(node) => {
                  if (node) closeNodes.current.set(tab.item.id, node);
                  else closeNodes.current.delete(tab.item.id);
                }}
                key={tab.item.id}
                type="button"
                className={`${styles.closeDraft} ${active || hoveredDraftId === tab.item.id ? styles.closeDraftVisible : ""}`}
                aria-label={`Close draft: ${label}`}
                data-draft-close-id={tab.item.id}
                tabIndex={-1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  requestClose(tab.item.id);
                }}
              ><X size={13} /></Button>;
            })}
          </div>
        </div>
      </> : <span className={styles.emptyDraftLabel}>No drafts</span>}
      <Button
        variant="ghost"
        size="icon"
        id={emptyDraftButtonId(projectId)}
        type="button"
        className={styles.newDraft}
        aria-label="New draft"
        title="New draft (Ctrl+N)"
        aria-keyshortcuts="Control+N Meta+N"
        onClick={(event) => onNew(event.currentTarget.matches(":focus-visible"))}
      ><Plus size={16} aria-hidden="true" /></Button>
    </div>
    {hasTabs && <>
      {tabs.map((tab) => <div
        key={editorKey(projectId, tab.item.id)}
        id={panelId(projectId, tab.item.id)}
        role="tabpanel"
        aria-labelledby={tabId(projectId, tab.item.id)}
        tabIndex={0}
        className={styles.draftPanel}
        hidden={workspace?.activeId !== tab.item.id}
      >
        <TaskEditor
          ref={(handle) => onRegister(tab.item.id, handle)}
          initialMarkdown={tab.item.content || ""}
          initiallySaved={tab.persisted}
          onChange={(body) => onChange(projectId, tab.item.id, body)}
          onStateChange={(state) => setEditorStates((current) => {
            const previous = current[tab.item.id];
            return previous
              && previous.error === state.error
              && previous.dirty === state.dirty
              && previous.saving === state.saving
              ? current
              : { ...current, [tab.item.id]: state };
          })}
          onSave={(body) => onSave(projectId, tab.item.id, body)}
          onSend={(body) => onSend(projectId, tab.item.id, body)}
          successMessage={successDraftId === tab.item.id ? "Work started" : undefined}
          keyboardFocus={keyboardFocusDraftId === tab.item.id}
          onPointerFocus={() => onPointerFocus(tab.item.id)}
        />
      </div>)}
    </>}
  </DashboardPane>
  <Modal
    title="Close unsaved draft?"
    open={dialog?.kind === "unsaved"}
    compact
    role="alertdialog"
    onClose={() => setDialog(undefined)}
  >
    <div className={styles.draftConfirmation}>
      <p>This draft has not been saved. Closing it will lose its contents.</p>
      <div>
        <Button variant="secondary" type="button" data-modal-autofocus onClick={() => setDialog(undefined)}>Keep editing</Button>
        <Button variant="danger" type="button" className={styles.dangerAction} onClick={() => {
          if (!dialog) return;
          onAbandon(projectId, dialog.draftId);
          setDialog(undefined);
        }}>Close without saving</Button>
      </div>
    </div>
  </Modal>
  <Modal
    title="Draft not closed"
    open={dialog?.kind === "closeError"}
    compact
    role="dialog"
    closeDisabled={discarding}
    onClose={() => setDialog(undefined)}
  >
    <div className={styles.draftConfirmation}>
      <p>The saved draft could not be removed. Try again.</p>
      <div>
        <Button variant="secondary" type="button" disabled={discarding} onClick={() => setDialog(undefined)}>Cancel</Button>
        <Button variant="primary" type="button" data-modal-autofocus disabled={discarding} onClick={async () => {
          if (!dialog) return;
          const draftId = dialog.draftId;
          setDialog(undefined);
          await closeSavedDraft(draftId);
        }}>{discarding ? "Retrying…" : "Try again"}</Button>
      </div>
    </div>
  </Modal>
  <div className={styles.draftWorkspaceSpacer} data-draft-workbench-spacer data-empty={!hasTabs || undefined} aria-hidden="true" style={workbenchStyle} /></>;
}

export function editorKey(projectId: string, draftId: string) {
  return `${projectId}:${draftId}`;
}

export function focusDraft(projectId: string, draftId: string) {
  requestAnimationFrame(() => {
    document.getElementById(panelId(projectId, draftId))
      ?.querySelector<HTMLElement>("[contenteditable='true']")
      ?.focus({ preventScroll: true });
  });
}

function domKey(value: string) {
  return encodeURIComponent(value);
}

function draftWorkspaceId(projectId: string) {
  return `draft-workspace-${domKey(projectId)}`;
}

export function tabId(projectId: string, draftId: string) {
  return `draft-tab-${domKey(projectId)}-${domKey(draftId)}`;
}

export function emptyDraftButtonId(projectId: string) {
  return `create-draft-${domKey(projectId)}`;
}

function panelId(projectId: string, draftId: string) {
  return `draft-panel-${domKey(projectId)}-${domKey(draftId)}`;
}

export function draftLabel(content?: string) {
  const line = content?.split(/\r?\n/).find((candidate) => candidate.trim());
  return line?.replace(/^\s{0,3}#{1,6}\s*/, "").trim() || "Untitled";
}

function hasOpenPopup() {
  return Boolean(document.querySelector('[role="menu"]:not([hidden]), [role="listbox"]:not([hidden])'));
}
