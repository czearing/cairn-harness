"use client";

import { Button } from "@/components/Button/Button";
import { FieldMessage, FormField, Input } from "@/components/FormField/FormField";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, FolderOpen, Plus, Sparkles } from "lucide-react";
import { IdentityEditor } from "../AgentIdentityEditor/AgentIdentityEditor";
import styles from "./NewProjectForm.module.css";

export interface ProjectDraft { name: string; workspace: string; color: string; avatar?: string; }
interface Props {
  workspaceRoot: string;
  onBrowse: (initial: string) => Promise<string | undefined>;
  onCreate: (draft: ProjectDraft) => Promise<void>;
  onCancel?: () => void;
  onComplete?: () => void;
}

export function NewProjectForm({ workspaceRoot, onBrowse, onCreate, onCancel, onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [color, setColor] = useState("#9ef0c0");
  const [avatar, setAvatar] = useState<string>();
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const selectingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const valid = Boolean(name.trim() && workspace);
  async function browse() {
    if (selectingRef.current) return;
    selectingRef.current = true;
    setSelecting(true); setError("");
    try {
      const selected = await onBrowse(workspace || workspaceRoot);
      if (selected) setWorkspace(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Folder selection failed");
    } finally {
      selectingRef.current = false;
      setSelecting(false);
    }
  }
  async function create() {
    setSaving(true); setError("");
    try {
      await onCreate({ name: name.trim(), workspace, color, avatar });
      setSuccess(true);
      window.setTimeout(() => onComplete?.(), 700);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Project creation failed"); }
    finally { setSaving(false); }
  }
  if (success) return <div className={styles.success}><div><Check size={24} /><Sparkles size={14} /></div><strong>Project ready</strong></div>;
  return <div className={styles.experience}>
    <div className={styles.steps}><div className={styles.active}><span>1</span><b>Details</b></div><i /><div className={step === 2 ? styles.active : ""}><span>2</span><b>Appearance</b></div></div>
    {step === 1 ? <div className={styles.content}>
      <FormField label="Name" required><Input data-modal-autofocus value={name} onChange={(event) => setName(event.target.value)} /></FormField>
      <FormField label={<>Workspace <Help text="Agents work in this folder." /></>} required description="Choose the folder where this project and its agents will work.">
        {(controlProps) => <Button {...controlProps} aria-label="Workspace" variant="inherit" className={styles.folder} type="button" disabled={selecting} onClick={() => void browse()}><FolderOpen size={15} /><span>{workspace || "Choose a folder"}</span><b>{selecting ? "Opening…" : "Browse"}</b></Button>}
      </FormField>
    </div> : <div className={styles.content}><IdentityEditor name={name || "New project"} color={color} avatar={avatar} onColor={setColor} onAvatar={setAvatar} /></div>}
    {error && <FieldMessage tone="error" aria-live="polite" className={styles.error}>{error}</FieldMessage>}
    <footer>{step === 1 ? <Button variant="secondary" className={styles.secondary} onClick={onCancel}>Cancel</Button> : <Button variant="secondary" className={styles.secondary} onClick={() => setStep(1)}><ArrowLeft size={14} />Back</Button>}<span />{step === 1
      ? <Button variant="primary" disabled={!valid || selecting} onClick={() => setStep(2)}>Continue<ArrowRight size={14} /></Button>
      : <Button variant="primary" disabled={saving} onClick={() => void create()}><Plus size={14} />{saving ? "Creating" : "Create project"}</Button>}</footer>
  </div>;
}

function Help({ text }: { text: string }) {
  return <span className={styles.help} tabIndex={0}><CircleHelp size={13} /><span role="tooltip">{text}</span></span>;
}
