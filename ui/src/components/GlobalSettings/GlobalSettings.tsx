"use client";

import { Button } from "@/components/Button/Button";
import { FieldMessage, FormField, Select } from "@/components/FormField/FormField";

import { useState } from "react";
import type { ModelSettings } from "@/lib/types";
import { modelCatalogCopy } from "@/lib/model-catalog-copy";
import styles from "./GlobalSettings.module.css";

export function GlobalSettingsForm({ settings, error, onSave, onRetry }: {
  settings?: ModelSettings;
  error?: string;
  onSave: (model: string) => Promise<void>;
  onRetry?: () => Promise<unknown>;
}) {
  const [model, setModel] = useState(settings?.defaultModel || "");
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedModel = model || settings?.defaultModel || "";
  const unavailable = Boolean(settings?.catalog.status === "ready" && selectedModel && !settings.models.some((candidate) => candidate.id === selectedModel));
  const catalogError = settings?.catalog.status === "error" ? settings.catalog : undefined;
  async function save() {
    if (!settings || !selectedModel || saving || catalogError || error) return;
    setSaving(true);
    setStatus("Saving");
    setSaveError("");
    try {
      await onSave(selectedModel);
      setStatus("Saved");
    } catch (cause) {
      setStatus("");
      setSaveError(cause instanceof Error ? cause.message : "Could not save global settings");
    } finally {
      setSaving(false);
    }
  }
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <header><h3>Default model</h3><p>Agents without an override inherit this model for their next turn. Active work is not interrupted.</p></header>
    {!settings && !error && <FieldMessage tone="status">Loading available models…</FieldMessage>}
    {error && <FieldMessage tone="error">{error}</FieldMessage>}
    {catalogError && <section className={styles.notice} role="alert">
      <strong>{modelCatalogCopy(catalogError).title}</strong>
      <p>{modelCatalogCopy(catalogError).body}</p>
      <p>Configured model: <code>{selectedModel}</code>. Availability is unknown. Existing settings are unchanged.</p>
      {onRetry && <Button variant="secondary" type="button" onClick={() => void onRetry()}>Retry model check</Button>}
      {catalogError.detail && <details><summary>Technical details</summary><pre>{catalogError.detail}</pre></details>}
    </section>}
    <FormField label="Global default model" description={settings ? <>The stable model ID <code>{selectedModel}</code> is persisted for all projects.</> : "Agents without an override inherit this model."}><Select data-drawer-initial-focus value={selectedModel} disabled={!settings || Boolean(error || catalogError)} onChange={(event) => { setModel(event.target.value); setStatus(""); }}>
      {unavailable && <option value={selectedModel}>Unavailable - {selectedModel}</option>}
      {settings?.models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
    </Select></FormField>
    {saveError && <FieldMessage tone="error">{saveError}</FieldMessage>}
    <footer>{status ? <FieldMessage tone={status === "Saved" ? "success" : "status"} aria-live="polite">{status}</FieldMessage> : <span />}<Button variant="primary" type="submit" disabled={!settings || !selectedModel || selectedModel === settings.defaultModel || saving || Boolean(error || catalogError)}>{saving ? "Saving" : "Save default"}</Button></footer>
  </form>;
}
