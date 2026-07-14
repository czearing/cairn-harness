"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, CircleHelp, Folder, Plus } from "lucide-react";
import { IdentityEditor } from "../AgentIdentityEditor/AgentIdentityEditor";
import styles from "./NewProjectForm.module.css";

export interface ProjectDraft { name: string; workspace: string; color: string; avatar?: string; }
interface Props { workspaceRoot: string; onCreate: (draft: ProjectDraft) => Promise<void>; }

export function NewProjectForm({ workspaceRoot, onCreate }: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState(join(workspaceRoot, "new-project"));
  const [customWorkspace, setCustomWorkspace] = useState(false);
  const [color, setColor] = useState("#9ef0c0");
  const [avatar, setAvatar] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = name.trim() && absolute(workspace.trim());
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
    <div className={styles.progress}><span className={step >= 1 ? styles.active : ""}>1</span><i /><span className={step >= 2 ? styles.active : ""}>2</span><small>{step === 1 ? "Project basics" : "Optional appearance"}</small></div>
    {step === 1 ? <div className={styles.content}>
      <div className={styles.intro}><h3>Create the shared workspace</h3><p>This creates project scaffolding only. You will add and configure agents from the project page next.</p></div>
      <label><span>Project name <Help text="Shown in the project sidebar. You can change appearance later." /></span><input data-modal-autofocus value={name} onChange={(event) => changeName(event.target.value)} placeholder="Website launch" /></label>
      <label><span>Workspace location <Help text="This folder is where agents will create files and collaborate. It is created if it does not exist." /></span><div className={styles.path}><Folder size={15} /><input aria-invalid={Boolean(workspace && !absolute(workspace))} aria-describedby={workspace && !absolute(workspace) ? "workspace-error" : undefined} value={workspace} onChange={(event) => { setCustomWorkspace(true); setWorkspace(event.target.value); }} /><button type="button" onClick={() => { setCustomWorkspace(false); setWorkspace(join(workspaceRoot, slug(name) || "new-project")); }}>Default</button></div></label>
      {workspace && !absolute(workspace) && <p id="workspace-error" role="alert" aria-live="polite" className={styles.error}>Enter an absolute folder path.</p>}
      <div className={styles.note}><strong>What gets created</strong><span>Project config, task inbox, delegated-action folder, and local runtime state. No agents are created or started.</span></div>
    </div> : <div className={styles.content}>
      <div className={styles.intro}><h3>Make it recognizable</h3><p>Color and picture are optional and can be changed from the project context menu.</p></div>
      <IdentityEditor name={name || "New project"} color={color} avatar={avatar} onColor={setColor} onAvatar={setAvatar} />
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <footer>{step === 2 && <button className={styles.secondary} onClick={() => setStep(1)}><ArrowLeft size={14} />Back</button>}<span />{step === 1
      ? <button disabled={!valid} onClick={() => setStep(2)}>Continue<ArrowRight size={14} /></button>
      : <button disabled={saving} onClick={() => void create()}><Plus size={14} />{saving ? "Creating" : "Create project"}</button>}</footer>
  </div>;
}

function Help({ text }: { text: string }) {
  return <span className={styles.help} tabIndex={0}><CircleHelp size={13} /><span role="tooltip">{text}</span></span>;
}
function slug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function join(root: string, leaf: string) { return `${root}${root.endsWith("\\") || root.endsWith("/") ? "" : root.includes("\\") ? "\\" : "/"}${leaf}`; }
function absolute(value: string) { return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/"); }
