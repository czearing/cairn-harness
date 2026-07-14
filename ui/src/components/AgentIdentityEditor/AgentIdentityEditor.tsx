"use client";

import { useState } from "react";
import type { Agent } from "@/lib/types";
import styles from "./AgentIdentityEditor.module.css";

interface Props { agent: Agent; color: string; avatar?: string; onColor: (color: string) => void; onAvatar: (avatar?: string) => void; }

export function AgentIdentityEditor({ agent, color, avatar, onColor, onAvatar }: Props) {
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  async function choose(file?: File) {
    if (!file) return;
    setError("");
    setProcessing(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
      onAvatar(await resizeImage(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare picture");
    } finally {
      setProcessing(false);
    }
  }
  return (
    <div className={styles.editor}>
      <div className={styles.preview} role="img" aria-label={`${agent.id} picture preview`} style={{ borderColor: color, color, backgroundImage: avatar ? `url("${avatar}")` : undefined }}>
        {!avatar && agent.id.slice(0, 2).toUpperCase()}
      </div>
      <h3>{agent.id}</h3>
      <label><span>Identity color</span><input aria-label={`${agent.id} color`} type="color" value={color} onChange={(event) => onColor(event.target.value)} /></label>
      <label className={styles.upload}><span>Profile picture</span><input aria-label={`${agent.id} picture`} type="file" accept="image/*" onChange={(event) => void choose(event.target.files?.[0])} /></label>
      {processing && <span className={styles.note}>Preparing picture</span>}
      {error && <span className={styles.error} role="alert">{error}</span>}
      {avatar && <button onClick={() => onAvatar()}>Remove picture</button>}
    </div>
  );
}

async function resizeImage(file: File) {
  const image = await createImageBitmap(file);
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
  image.close();
  return canvas.toDataURL("image/webp", 0.82);
}
