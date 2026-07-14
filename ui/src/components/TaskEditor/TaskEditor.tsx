"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Send, X } from "lucide-react";
import { MarkdownEditor } from "../MarkdownEditor/MarkdownEditor";
import styles from "./TaskEditor.module.css";

interface Props {
  initialMarkdown: string; status: string; draft?: boolean; onBack: () => void;
  onSave: (markdown: string) => Promise<void>; onSend?: (markdown: string) => Promise<void>;
}

export function TaskEditor({ initialMarkdown, status, draft, onBack, onSave, onSend }: Props) {
  const [content, setContent] = useState(initialMarkdown);
  const [saveState, setSaveState] = useState(initialMarkdown ? "Saved" : "Draft");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function save(markdown = content) {
    clearTimeout(timer.current);
    setSaveState("Saving");
    setError("");
    try {
      await onSave(markdown);
      setSaveState("Saved");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
      setSaveState("Unsaved");
      return false;
    }
  }
  function changed(markdown: string) {
    setContent(markdown);
    setSaveState("Unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(markdown), 250);
  }
  async function send() {
    if (!content.trim() || !onSend) return;
    if (!await save()) return;
    try { await onSend(content); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send task"); }
  }
  return (
    <section className={styles.workspace} aria-label="Task editor">
      <header>
        <div><span>{draft ? "Draft" : status}</span><strong>{saveState}</strong></div>
        <button onClick={() => void save()}><Check size={14} />Save{draft ? " draft" : ""}</button>
        {draft && <button className={styles.send} disabled={!content.trim()} onClick={() => void send()}><Send size={14} />Send to work</button>}
        <button className={styles.close} onClick={() => void save().then((saved) => saved && onBack())} aria-label="Close editor"><X size={15} /></button>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <MarkdownEditor initialMarkdown={initialMarkdown} onChange={changed} label="Task document" placeholder="Describe what should happen..." autoFocus />
    </section>
  );
}
