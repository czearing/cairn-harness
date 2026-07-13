"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import styles from "./MessageComposer.module.css";

interface Props { agent: string; onSend: (message: string) => Promise<void> | void; }

export function MessageComposer({ agent, onSend }: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await onSend(message.trim());
      setMessage("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message failed");
    } finally {
      setSending(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="agent-message">Message {agent}</label>
      <textarea id="agent-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Send a clear request" rows={4} />
      {error && <p role="alert">{error}</p>}
      <button disabled={!message.trim() || sending}><Send size={14} />{sending ? "Sending" : "Send message"}</button>
    </form>
  );
}
