"use client";

import { Button } from "@/components/Button/Button";
import { FieldMessage, FormField, Input } from "@/components/FormField/FormField";

import { useState } from "react";
import type { Project } from "@/lib/types";
import styles from "./AutomationForm.module.css";

export interface ProjectWorkflowDraft {
  maxActiveTasks?: number;
}

export function AutomationForm({ project, onSave, onCancel }: {
  project: Project; onSave: (draft: ProjectWorkflowDraft) => Promise<void>; onCancel: () => void;
}) {
  const [maxActiveTasks, setMaxActiveTasks] = useState<number | "">(project.maxActiveTasks ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await onSave({
        maxActiveTasks: maxActiveTasks === "" ? undefined : maxActiveTasks,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    }
    finally { setSaving(false); }
  }
  return <div className={styles.form}>
    <section className={styles.section}><h3>Active project work</h3><p>Limit manual work items submitted to the project leader. Chat, delegated work, and generated ideas do not use these slots.</p>
      <FormField label="Maximum active work items" optional description="Extra manual leader work waits in oldest-first backlog order. Leave blank for no limit."><Input data-modal-autofocus type="number" min={1} max={1000} placeholder="No limit" value={maxActiveTasks} onChange={(event) => setMaxActiveTasks(event.target.value ? Number(event.target.value) : "")} /></FormField>
    </section>
    {error && <FieldMessage tone="error">{error}</FieldMessage>}
    <footer><Button variant="secondary" className={styles.secondary} onClick={onCancel}>Cancel</Button><span /><Button variant="primary" disabled={saving || (maxActiveTasks !== "" && maxActiveTasks < 1)} onClick={() => void save()}>{saving ? "Saving" : "Save"}</Button></footer>
  </div>;
}
