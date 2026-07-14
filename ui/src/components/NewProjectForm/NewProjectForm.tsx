"use client";

import { useState } from "react";
import { CircleHelp, Folder, Palette, Plus } from "lucide-react";
import { IdentityEditor } from "../AgentIdentityEditor/AgentIdentityEditor";
import styles from "./NewProjectForm.module.css";

export interface ProjectDraft { name: string; workspace: string; color: string; avatar?: string; }
interface Props { workspaceRoot: string; onCreate: (draft: ProjectDraft) => Promise<void>; onCancel?: () => void; }

export function NewProjectForm({ workspaceRoot, onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState(join(workspaceRoot, "new-project"));
  const [customWorkspace, setCustomWorkspace] = useState(false);
  const [color, setColor] = useState("#9ef0c0");
  const [avatar, setAvatar] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = Boolean(name.trim() && absolute(workspace.trim()));
  function changeName(value: string) {
    setName(value);
    if (!customWorkspace) setWorkspace(join(workspaceRoot, slug(value) || "new-project"));
  }
  async function create() {
    setSaving(true); setError("");
    try { await onCreate({ name: name.trim(), workspace: workspace.trim(), color, avatar }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Project creation failed"); }
    finally { setSaving(false); }
  }
  return <div className={styles.experience}>
    <div className={styles.content}>
      <label><span>Name</span><input data-modal-autofocus value={name} onChange={(event) => changeName(event.target.value)} placeholder="Website launch" /></label>
      <label><span>Workspace <Help text="Agents work in this folder." /></span><div className={styles.path}><Folder size={15} /><input aria-invalid={Boolean(workspace && !absolute(workspace))} aria-describedby={workspace && !absolute(workspace) ? "workspace-error" : undefined} value={workspace} onChange={(event) => { setCustomWorkspace(true); setWorkspace(event.target.value); }} /><button type="button" onClick={() => { setCustomWorkspace(false); setWorkspace(join(workspaceRoot, slug(name) || "new-project")); }}>Default</button></div></label>
      {workspace && !absolute(workspace) && <p id="workspace-error" role="alert" aria-live="polite" className={styles.error}>Enter an absolute folder path.</p>}
      <details className={styles.appearance}><summary><Palette size={14} />Appearance <span>Optional</span></summary><IdentityEditor name={name || "New project"} color={color} avatar={avatar} onColor={setColor} onAvatar={setAvatar} /></details>
    </div>
    {error && <p role="alert" className={styles.submitError}>{error}</p>}
    <footer><button className={styles.secondary} onClick={onCancel}>Cancel</button><span /><button disabled={!valid || saving} onClick={() => void create()}><Plus size={14} />{saving ? "Creating" : "Create project"}</button></footer>
  </div>;
}

function Help({ text }: { text: string }) {
  return <span className={styles.help} tabIndex={0}><CircleHelp size={13} /><span role="tooltip">{text}</span></span>;
}
function slug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function join(root: string, leaf: string) { return `${root}${root.endsWith("\\") || root.endsWith("/") ? "" : root.includes("\\") ? "\\" : "/"}${leaf}`; }
function absolute(value: string) { return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/"); }
