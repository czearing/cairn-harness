"use client";

import { Button } from "@/components/Button/Button";
import { FieldMessage, FormField, Input, Select, Textarea } from "@/components/FormField/FormField";

import { useState } from "react";
import type { Agent, ModelSettings } from "@/lib/types";
import { IdentityEditor } from "../AgentIdentityEditor/AgentIdentityEditor";
import styles from "./AgentWorkspace.module.css";

export function IdentitySection({
  agent,
  onChange,
}: {
  agent: Agent;
  onChange: (values: { title: string; description: string }) => void;
}) {
  const [title, setTitle] = useState(agent.title || agent.id);
  const [description, setDescription] = useState(agent.role || "");
  return <section className={styles.settingSection} aria-labelledby="agent-identity-title">
    <h3 id="agent-identity-title">Identity</h3>
    <div className={styles.fields}>
      <FormField label="Title" required><Input value={title} onChange={(event) => {
        setTitle(event.target.value);
        onChange({ title: event.target.value, description });
      }} /></FormField>
      <FormField label="Description" required><Textarea rows={3} value={description} onChange={(event) => {
        setDescription(event.target.value);
        onChange({ title, description: event.target.value });
      }} /></FormField>
    </div>
  </section>;
}

export function ModelSection({
  agent,
  settings,
  settingsError,
  onChange,
  onRetry,
}: {
  agent: Agent;
  settings?: ModelSettings;
  settingsError?: string;
  onChange: (model?: string) => void;
  onRetry: () => Promise<unknown>;
}) {
  const [model, setModel] = useState(agent.model || "");
  const defaultModel = settings?.models.find((option) => option.id === settings.defaultModel)?.name || settings?.defaultModel;
  const modelIsKnown = settings?.models.some((option) => option.id === model);
  function change(nextModel: string) {
    setModel(nextModel);
    onChange(nextModel || undefined);
  }
  return <section className={styles.settingSection}>
    <div className={styles.fields}>
      {settingsError && <FieldMessage tone="warning" action={<Button variant="secondary" size="compact" type="button" onClick={() => void onRetry()}>Retry model check</Button>}>{settingsError}</FieldMessage>}
      <FormField label="Model"><Select value={model} onChange={(event) => change(event.target.value)}>
        <option value="">Default{defaultModel ? ` — ${defaultModel}` : ""}</option>
        {model && !modelIsKnown && <option value={model}>Unavailable — {model}</option>}
        {settings?.models.length ? <optgroup label="Override">
          {settings.models.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </optgroup> : null}
      </Select></FormField>
    </div>
  </section>;
}

export function AppearanceSection({
  agent, color, avatar, onColor, onAvatar,
}: {
  agent: Agent; color: string; avatar?: string;
  onColor: (color: string) => void; onAvatar: (avatar?: string) => void;
}) {
  return <section className={styles.settingSection} aria-labelledby="agent-appearance-title">
    <h3 id="agent-appearance-title">Appearance</h3>
    <div className={styles.fields}><IdentityEditor name={agent.title || agent.id} color={color} avatar={avatar} onColor={onColor} onAvatar={onAvatar} /></div>
  </section>;
}
