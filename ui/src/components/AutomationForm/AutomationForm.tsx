"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";
import styles from "./AutomationForm.module.css";

export function AutomationForm({ project, onSave, onCancel }: {
  project: Project; onSave: (producer?: string, limit?: number) => Promise<void>; onCancel: () => void;
}) {
  const [producer, setProducer] = useState(project.producerId || "");
  const [limit, setLimit] = useState(project.producerLimit || 3);
  const [saving, setSaving] = useState(false);
  const available = project.agents.filter((agent) => agent.status !== "paused");
  async function save() {
    setSaving(true);
    try { await onSave(producer || undefined, producer ? limit : undefined); }
    finally { setSaving(false); }
  }
  return <div className={styles.form}>
    <div className={styles.explainer}><strong>How it works</strong><span>When the project is idle, this agent creates the next task. It stops at the limit below. Manual tasks do not count.</span></div>
    <label><span>Idea agent</span><select value={producer} onChange={(event) => setProducer(event.target.value)}><option value="">Off</option>{available.map((agent) => <option key={agent.id} value={agent.id}>{agent.id}</option>)}</select></label>
    <label><span>Automatic task limit</span><input type="number" min={1} max={1000} disabled={!producer} value={limit} onChange={(event) => setLimit(Number(event.target.value))} /></label>
    {project.generatedWorkCount ? <p>{project.generatedWorkCount} automatic task{project.generatedWorkCount === 1 ? "" : "s"} created so far.</p> : null}
    {!project.agents.length && <p>Create an agent before enabling automatic work.</p>}
    <footer><button className={styles.secondary} onClick={onCancel}>Cancel</button><span /><button disabled={saving || (Boolean(producer) && limit < 1)} onClick={() => void save()}>{saving ? "Saving" : "Save"}</button></footer>
  </div>;
}
