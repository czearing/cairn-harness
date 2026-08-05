"use client";

import { Button } from "@/components/Button/Button";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MarkdownEditor } from "../MarkdownEditor/MarkdownEditor";
import { StatusIndicator, type StatusKind } from "../StatusIndicator/StatusIndicator";
import styles from "./TaskEditor.module.css";

interface Props {
  initialMarkdown: string;
  initiallySaved?: boolean;
  onChange?: (markdown: string) => void;
  onStateChange?: (state: TaskEditorState) => void;
  onSave: (markdown: string) => Promise<void>;
  onSend?: (markdown: string) => Promise<void>;
  successMessage?: string;
  keyboardFocus?: boolean;
  onPointerFocus?: () => void;
}

interface SaveRequest {
  markdown: string;
  revision: number;
}

interface SaveWaiter {
  revision: number;
  resolve: (saved: boolean) => void;
}

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

export interface TaskEditorState {
  error: boolean;
  dirty: boolean;
  saving: boolean;
}

export interface TaskEditorHandle {
  saveLatest: () => Promise<boolean>;
}

export const TaskEditor = forwardRef<TaskEditorHandle, Props>(function TaskEditor(
  { initialMarkdown, initiallySaved = false, onChange, onStateChange, onSave, onSend, successMessage, keyboardFocus, onPointerFocus },
  ref,
) {
  const [hasContent, setHasContent] = useState(Boolean(initialMarkdown.trim()));
  const [saveState, setSaveState] = useState<SaveState>(initiallySaved ? "saved" : "clean");
  const [submissionState, setSubmissionState] = useState<"saving" | "sending">();
  const [saveError, setSaveError] = useState("");
  const [createError, setCreateError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedStatusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentRef = useRef(initialMarkdown);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const activeSave = useRef<SaveRequest | undefined>(undefined);
  const queuedSave = useRef<SaveRequest | undefined>(undefined);
  const saveWaiters = useRef<SaveWaiter[]>([]);
  const submitting = useRef(false);
  const canCreate = Boolean(hasContent && onSend && !submissionState && saveState !== "error");

  useImperativeHandle(ref, () => ({ saveLatest }));
  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(savedStatusTimer.current);
  }, []);
  useEffect(() => {
    onStateChange?.({
      error: Boolean(saveError || createError),
      dirty: saveState === "dirty" || saveState === "error",
      saving: saveState === "saving",
    });
  }, [createError, onStateChange, saveError, saveState]);
  useEffect(() => {
    if (!successMessage) return;
    contentRef.current = initialMarkdown;
    revision.current = 0;
    savedRevision.current = 0;
    queuedSave.current = undefined;
    setHasContent(Boolean(initialMarkdown.trim()));
    setSaveState("clean");
    setSaveError("");
    setCreateError("");
  }, [initialMarkdown, successMessage]);

  function showSaved() {
    clearTimeout(savedStatusTimer.current);
    setSaveState("saved");
    savedStatusTimer.current = setTimeout(() => setSaveState((current) => current === "saved" ? "clean" : current), 1400);
  }

  async function drainSaves() {
    while (queuedSave.current) {
      const request = queuedSave.current;
      queuedSave.current = undefined;
      activeSave.current = request;
      setSaveState("saving");
      setSaveError("");
      let saved = false;
      try {
        await onSave(request.markdown);
        savedRevision.current = Math.max(savedRevision.current, request.revision);
        saved = true;
      } catch (cause) {
        if (!queuedSave.current && revision.current <= request.revision) {
          setSaveError(cause instanceof Error ? cause.message : "Save failed");
          setSaveState("error");
        }
      }
      const completed = saveWaiters.current.filter((waiter) => waiter.revision <= request.revision);
      saveWaiters.current = saveWaiters.current.filter((waiter) => waiter.revision > request.revision);
      completed.forEach((waiter) => waiter.resolve(saved));
      activeSave.current = undefined;
      if (saved && !queuedSave.current && revision.current <= request.revision) showSaved();
    }
  }

  function requestSave(markdown: string, requestedRevision: number) {
    clearTimeout(timer.current);
    clearTimeout(savedStatusTimer.current);
    setSaveState("saving");
    setSaveError("");
    return new Promise<boolean>((resolve) => {
      saveWaiters.current.push({ revision: requestedRevision, resolve });
      if (!activeSave.current || requestedRevision > activeSave.current.revision) {
        if (!queuedSave.current || requestedRevision >= queuedSave.current.revision) {
          queuedSave.current = { markdown, revision: requestedRevision };
        }
      }
      if (!activeSave.current) void drainSaves();
    });
  }

  async function saveLatest() {
    clearTimeout(timer.current);
    if (savedRevision.current >= revision.current && !activeSave.current && !queuedSave.current) return true;
    if (!initialMarkdown.trim() && revision.current === 0 && !contentRef.current.trim()) return true;
    while (true) {
      const requestedRevision = revision.current;
      const saved = await requestSave(contentRef.current, requestedRevision);
      if (!saved && revision.current <= requestedRevision) return false;
      if (savedRevision.current >= revision.current && !activeSave.current && !queuedSave.current) return true;
    }
  }

  function changed(markdown: string) {
    contentRef.current = markdown;
    revision.current += 1;
    setHasContent(Boolean(markdown.trim()));
    setSaveState("dirty");
    setCreateError("");
    onChange?.(markdown);
    clearTimeout(timer.current);
    clearTimeout(savedStatusTimer.current);
    const requestedRevision = revision.current;
    if (activeSave.current) void requestSave(markdown, requestedRevision);
    else timer.current = setTimeout(() => void requestSave(markdown, requestedRevision), 250);
  }

  async function createTask() {
    if (submitting.current || !contentRef.current.trim() || !onSend || saveState === "error") return;
    submitting.current = true;
    const hasUnsavedContent = savedRevision.current < revision.current || Boolean(activeSave.current || queuedSave.current);
    setSubmissionState(hasUnsavedContent ? "saving" : "sending");
    setCreateError("");
    clearTimeout(timer.current);
    try {
      if (!await saveLatest()) return;
      setSubmissionState("sending");
      await onSend(contentRef.current);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not start work");
    } finally {
      submitting.current = false;
      setSubmissionState(undefined);
    }
  }

  const statusText = successMessage
    || (createError
      ? "Work not started"
      : saveState === "error"
        ? "Not saved"
        : "");
  const statusKind: StatusKind = saveError || createError ? "failed" : "saved";
  const showStatus = Boolean(successMessage || createError || saveError);
  return (
    <section className={styles.workspace} aria-label="Draft editor">
      <MarkdownEditor
        initialMarkdown={initialMarkdown}
        onChange={changed}
        onSubmit={() => void createTask()}
        canSubmit={canCreate}
        label="Draft document"
        placeholder="Describe the work to start…"
        layout="workspace"
        keyboardFocus={keyboardFocus}
        onPointerFocus={onPointerFocus}
        resetKey={successMessage}
      />
      <footer className={styles.footer}>
        <div className={styles.feedback}>
          {showStatus && <StatusIndicator status={statusKind} label={statusText} size="compact" announce />}
          {(saveError || createError) && <Button variant="danger" size="compact" className={styles.retry} type="button" title={saveError || createError} onClick={() => void (saveError ? saveLatest() : createTask())}>Retry</Button>}
        </div>
        <Button
          variant="primary"
          className={styles.create}
          type="button"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          title="Start work (Ctrl+Enter)"
          loading={Boolean(submissionState)}
          disabled={!canCreate}
          onClick={() => void createTask()}
        >
          {submissionState ? "Starting work…" : "Start work"}
        </Button>
      </footer>
    </section>
  );
});
