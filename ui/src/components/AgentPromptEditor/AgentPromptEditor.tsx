"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Agent } from "@/lib/types";
import { MarkdownEditor } from "../MarkdownEditor/MarkdownEditor";
import styles from "./AgentPromptEditor.module.css";

export function AgentPromptEditor({ agent, onSave, onClose }: { agent: Agent; onSave: (prompt: string) => Promise<void>; onClose: () => void }) {
  const [prompt, setPrompt] = useState(agent.prompt || "");
  const [state, setState] = useState("");
  async function save() {
    setState("Saving");
    try { await onSave(prompt); setState("Saved"); }
    catch (error) { setState(error instanceof Error ? error.message : "Save failed"); }
  }
  return (
    <div className={styles.editor}>
      <header><div><strong>{agent.id} prompt</strong><span>Instructions used when this agent starts work.</span></div><button aria-label="Close prompt editor" onClick={onClose}><X size={15} /></button></header>
      <MarkdownEditor initialMarkdown={agent.prompt || ""} onChange={setPrompt} label={`${agent.id} prompt`} placeholder="Describe this agent's responsibility..." />
      <footer><span>{state}</span><button onClick={() => void save()}>Save prompt</button></footer>
    </div>
  );
}
