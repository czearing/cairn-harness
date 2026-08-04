"use client";

import { Button } from "@/components/Button/Button";
import { FieldMessage, FormField, Input, Textarea } from "@/components/FormField/FormField";

import { useRef, useState } from "react";
import styles from "./AgentIdentityEditor.module.css";

interface Props {
  name: string; title?: string; description?: string; color: string; avatar?: string;
  onColor: (color: string) => void; onAvatar: (avatar?: string) => void;
  onDetails?: (title: string, description: string) => Promise<void>;
}

export function IdentityEditor({ name, title, description, color, avatar, onColor, onAvatar, onDetails }: Props) {
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [nextTitle, setNextTitle] = useState(title || "");
  const [nextDescription, setNextDescription] = useState(description || "");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  async function choose(file?: File) {
    if (!file || processingRef.current) return;
    processingRef.current = true;
    setError("");
    setProcessing(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
      const resized = await resizeImage(file);
      onAvatar(resized);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare picture");
    } finally {
      processingRef.current = false;
      setProcessing(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function saveDetails() {
    if (!onDetails || saving || !nextTitle.trim() || !nextDescription.trim()) return;
    setSaving(true);
    setError("");
    try { await onDetails(nextTitle, nextDescription); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save agent"); }
    finally { setSaving(false); }
  }
  return (
    <div className={styles.editor}>
      <div className={styles.preview} role="img" aria-label={`${name} picture preview`} style={{ borderColor: color, color, backgroundImage: avatar ? `url("${avatar}")` : undefined }}>
        {!avatar && name.slice(0, 2).toUpperCase()}
      </div>
      <h3>{title || name}</h3>
      {onDetails && <div className={styles.details}>
        <FormField label="Title" required><Input aria-label={`${name} title`} value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} /></FormField>
        <FormField label="Description" required><Textarea aria-label={`${name} description`} rows={3} value={nextDescription} onChange={(event) => setNextDescription(event.target.value)} /></FormField>
        <Button variant="primary" className={styles.save} disabled={saving || !nextTitle.trim() || !nextDescription.trim() || (nextTitle === title && nextDescription === description)} onClick={() => void saveDetails()}>{saving ? "Saving" : "Save details"}</Button>
      </div>}
      <FormField label="Identity color" layout="inline"><Input variant="color" aria-label={`${name} color`} type="color" value={color} onChange={(event) => onColor(event.target.value)} /></FormField>
      <FormField label="Picture" optional description="Use an image file; Harness crops it to a square."><Input variant="file" ref={fileInput} aria-label={`${name} picture`} type="file" accept="image/*" disabled={processing} onChange={(event) => void choose(event.target.files?.[0])} /></FormField>
      {processing && <FieldMessage tone="status">Preparing picture</FieldMessage>}
      {error && <FieldMessage tone="error">{error}</FieldMessage>}
      {avatar && <Button variant="danger" className={styles.danger} disabled={processing} onClick={() => onAvatar()}>Remove picture</Button>}
    </div>
  );
}

export async function resizeImage(file: File) {
  const image = await createImageBitmap(file);
  try {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image");
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    image.close();
  }
}
