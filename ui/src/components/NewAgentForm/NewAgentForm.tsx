"use client";

import { Button } from "@/components/Button/Button";
import { FieldMessage, FormField, Input, Select, Textarea } from "@/components/FormField/FormField";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ModelSettings } from "@/lib/types";
import styles from "./NewAgentForm.module.css";

export interface AgentDraft { name: string; description: string; prompt: string; model?: string; }

export function NewAgentForm({ first, settings, settingsError, onCreate, onCancel }: { first: boolean; settings?: ModelSettings; settingsError?: string; onCreate: (draft: AgentDraft) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const catalogError = settings?.catalog.status === "error" ? settings.catalog : undefined;
  const valid = Boolean(name.trim() && description.trim() && prompt.trim() && settings && !settingsError && (!model || settings.catalog.status === "ready"));
  async function create() {
    if (!valid || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError("");
    try { await onCreate({ name, description, prompt, model: model || undefined }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Agent creation failed"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void create(); }}>
    {first && <p>The first agent becomes project lead.</p>}
    <FormField label="Name" required><Input data-modal-autofocus value={name} onChange={(event) => setName(event.target.value)} /></FormField>
    <FormField label="Role" required><Input value={description} onChange={(event) => setDescription(event.target.value)} /></FormField>
    <FormField label="Instructions" required description="Responsibilities, constraints, and definition of done."><Textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></FormField>
    {!settings && !settingsError && <FieldMessage tone="status">Loading available models…</FieldMessage>}
    {(settingsError || catalogError) && <FieldMessage tone="warning">{settingsError || "Models couldn’t be checked. The new agent can still use the global default."}</FieldMessage>}
    <FormField label="Model" description={settings ? (model ? "This agent will use its model override." : `Inherits the global default (${settings.defaultModel}).`) : "Choose an available model or inherit the global default."}><Select value={model} disabled={!settings || Boolean(settingsError || catalogError)} onChange={(event) => setModel(event.target.value)}>
      <option value="">Use global default - {settings?.models.find((candidate) => candidate.id === settings.defaultModel)?.name || settings?.defaultModel || "Loading"}</option>
      {settings?.models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
    </Select></FormField>
    {error && <FieldMessage tone="error">{error}</FieldMessage>}
    <footer><Button variant="secondary" type="button" className={styles.secondary} onClick={onCancel}>Cancel</Button><span /><Button variant="primary" type="submit" disabled={!valid || saving}><Plus size={14} />{saving ? "Creating" : "Create agent"}</Button></footer>
  </form>;
}
