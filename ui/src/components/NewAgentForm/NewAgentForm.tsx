"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import styles from "./NewAgentForm.module.css";

export interface AgentDraft { name: string; description: string; prompt: string; }

export function NewAgentForm({ first, onCreate, onCancel }: { first: boolean; onCreate: (draft: AgentDraft) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = name.trim() && description.trim() && prompt.trim();
  async function create() {
    setSaving(true); setError("");
    try { await onCreate({ name, description, prompt }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Agent creation failed"); }
    finally { setSaving(false); }
  }
  return <div className={styles.form}>
    {first && <p>The first agent becomes project lead.</p>}
    <label><span>Name</span><input data-modal-autofocus value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label><span>Role</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label><span>Instructions</span><textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <footer><button className={styles.secondary} onClick={onCancel}>Cancel</button><span /><button disabled={!valid || saving} onClick={() => void create()}><Plus size={14} />{saving ? "Creating" : "Create agent"}</button></footer>
  </div>;
}
