"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import styles from "./NewProjectForm.module.css";

interface Props { onCreate: (name: string, roles: string) => Promise<void>; }

export function NewProjectForm({ onCreate }: Props) {
  const [name, setName] = useState("");
  const [roles, setRoles] = useState("lead | Project lead | Plan and delegate.\nbuilder | Builder | Complete assigned work.");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try { await onCreate(name.trim(), roles.trim()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Project creation failed"); }
    finally { setSaving(false); }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="project-name">Project name</label>
      <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New project" />
      <label htmlFor="project-agents">Agents</label>
      <textarea id="project-agents" value={roles} onChange={(event) => setRoles(event.target.value)} rows={7} />
      <p className={styles.hint}>One per line: name | description | prompt</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <button disabled={!name.trim() || saving}><Plus size={14} />{saving ? "Creating" : "Create project"}</button>
    </form>
  );
}
