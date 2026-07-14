"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import styles from "./MessageComposer.module.css";

interface Props { agent: string; onSend: (message: string) => Promise<void> | void; }

export function MessageComposer({ agent, onSend }: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function send() {
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
  function submit(event: React.FormEvent) {
    event.preventDefault();
    void send();
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="agent-message">Message {agent}</label>
      <textarea id="agent-message" aria-keyshortcuts="Control+Enter Meta+Enter" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void send();
        }
      }} placeholder="Send a clear request" rows={4} />
      {error && <p role="alert">{error}</p>}
      <button disabled={!message.trim() || sending}><Send size={14} />{sending ? "Sending" : "Send message"}</button>
    </form>
  );
}
