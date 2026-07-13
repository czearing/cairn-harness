"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import styles from "./WorkItemForm.module.css";

export function WorkItemForm({ onCreate }: { onCreate: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onCreate(text.trim());
      setText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Work item failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="work-item">New work item</label>
      <textarea id="work-item" value={text} onChange={(event) => setText(event.target.value)} placeholder="Describe the outcome" rows={5} />
      {error && <p role="alert">{error}</p>}
      <button disabled={!text.trim() || saving}><Plus size={14} />{saving ? "Adding" : "Add work item"}</button>
    </form>
  );
}
