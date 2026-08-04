"use client";

import { Button } from "@/components/Button/Button";
import { Textarea } from "@/components/FormField/FormField";
import { Send } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./MessageComposer.module.css";

interface Props {
  projectId: string;
  agent: string;
  initialFocus?: boolean;
  onSend: (message: string, submissionId: string) => Promise<void> | void;
}

export function MessageComposer({ projectId, agent, initialFocus = true, onSend }: Props) {
  const [message, setMessage] = useState("");
  const submissionId = useRef("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const generatedId = useId();
  const fieldId = `agent-message-${generatedId}`;
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = "0";
    node.style.height = `${Math.min(140, Math.max(52, node.scrollHeight))}px`;
    node.style.overflowY = node.scrollHeight > 140 ? "auto" : "hidden";
  }, [message]);
  function send() {
    if (!message.trim()) return;
    submissionId.current ||= `${encodeURIComponent(projectId)}:${crypto.randomUUID()}`;
    const body = message.trim();
    const id = submissionId.current;
    setMessage("");
    submissionId.current = "";
    void onSend(body, id);
    requestAnimationFrame(() => textarea.current?.focus());
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    void send();
  }
  function changeMessage(value: string) {
    if (value !== message) {
      submissionId.current = "";
    }
    setMessage(value);
  }
  return (
    <form className={styles.form} onSubmit={submit} aria-label={`Send message to ${agent}`} data-message-composer>
      <label className={styles.srOnly} htmlFor={fieldId}>Message {agent}</label>
      <Textarea variant="bare" className={styles.textarea} ref={textarea} id={fieldId} data-drawer-initial-focus={initialFocus ? "" : undefined} aria-keyshortcuts="Control+Enter Meta+Enter" value={message} onChange={(event) => changeMessage(event.target.value)} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          send();
        }
      }} placeholder={`Message ${agent}...`} rows={1} />
      <Button className={styles.send} variant="primary" size="icon" aria-label="Send message" title="Send message (Ctrl+Enter)" disabled={!message.trim()}>
        <Send size={16} aria-hidden="true" />
      </Button>
    </form>
  );
}
