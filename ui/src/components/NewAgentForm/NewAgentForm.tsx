"use client";

import { Button } from "@/components/Button/Button";
import { FieldMessage, FormField, Input, Select, Textarea } from "@/components/FormField/FormField";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Agent, ModelSettings } from "@/lib/types";
import styles from "./NewAgentForm.module.css";

export interface AgentDraft { name: string; description: string; prompt: string; model?: string; replicaOf?: string; }

export function NewAgentForm({ first, agents, settings, settingsError, onCreate, onCancel }: { first: boolean; agents?: Agent[]; settings?: ModelSettings; settingsError?: string; onCreate: (draft: AgentDraft) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [replicaOf, setReplicaOf] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const catalogError = settings?.catalog.status === "error" ? settings.catalog : undefined;
  const replicaCandidates = (agents || []).filter((agent) => agent.kind !== "local");
  const valid = Boolean(name.trim() && description.trim() && prompt.trim() && settings && !settingsError && (!model || settings.catalog.status === "ready"));

  function chooseReplicaOf(sourceId: string) {
    setReplicaOf(sourceId);
    const source = replicaCandidates.find((agent) => agent.id === sourceId);
    if (!source) return;
    const siblings = replicaCandidates.filter((agent) => agent.id === source.id || agent.sourceAgentId === (source.sourceAgentId || source.id));
    const nextOrdinal = Math.max(0, ...siblings.map((agent) => agent.instanceOrdinal || 0)) + 1;
    setName(`${source.id}-${nextOrdinal}`);
    setDescription(source.role || "");
    setPrompt(source.prompt || "");
  }

  async function create() {
    if (!valid || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError("");
    try { await onCreate({ name, description, prompt, model: model || undefined, replicaOf: replicaOf || undefined }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Agent creation failed"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void create(); }}>
    {first && <p>The first agent becomes project lead.</p>}
    {!first && replicaCandidates.length > 0 && <FormField label="Replica of" description="Runs the same role in parallel. New root work is routed to whichever pool member is idlest instead of always the same agent.">
      <Select value={replicaOf} onChange={(event) => chooseReplicaOf(event.target.value)}>
        <option value="">None — independent agent</option>
        {replicaCandidates.map((agent) => <option key={agent.id} value={agent.id}>{agent.title || agent.id}</option>)}
      </Select>
    </FormField>}
    {replicaOf && <FieldMessage tone="status">Name, role, and instructions were copied from the source agent. Update anything that should differ for this replica, such as a separate workspace path.</FieldMessage>}
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
