import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/types";
import styles from "./MessageBody.module.css";

export function MessageBody({ message, collapsibleTool = true, compact = false }: { message: ChatMessage; collapsibleTool?: boolean; compact?: boolean }) {
  const body = envelopeBody(message.body);
  if (message.kind === "tool" && collapsibleTool) {
    return <details className={styles.details}>
      <summary>Show details</summary>
      <FormattedBody body={body} compact />
    </details>;
  }
  return <FormattedBody body={body} compact={compact} />;
}

function FormattedBody({ body, compact = false }: { body: string; compact?: boolean }) {
  const json = prettyJson(body);
  if (json) return <pre className={styles.code}><code>{json}</code></pre>;
  return <div className={`${styles.markdown} ${compact ? styles.compact : ""}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
        table: ResponsiveTable,
      }}
    >
      {body}
    </ReactMarkdown>
  </div>;
}

function ResponsiveTable({ node: _node, ...props }: ComponentPropsWithoutRef<"table"> & { node?: unknown }) {
  void _node;
  const wrapper = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [label, setLabel] = useState("Scrollable table in message");

  useEffect(() => {
    const container = wrapper.current;
    const tableElement = table.current;
    if (!container || !tableElement) return;
    const measure = () => {
      const hasOverflow = container.scrollWidth > container.clientWidth + 1;
      setOverflowing(hasOverflow);
      if (hasOverflow) setLabel(tableLabel(tableElement));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(tableElement);
    return () => observer.disconnect();
  }, []);

  return <div
    ref={wrapper}
    className={styles.tableScroll}
    role={overflowing ? "region" : undefined}
    tabIndex={overflowing ? 0 : undefined}
    aria-label={overflowing ? label : undefined}
  >
    <table ref={table} {...props} />
  </div>;
}

function tableLabel(table: HTMLTableElement) {
  const headers = [...table.querySelectorAll("thead tr:first-child th")]
    .map((header) => header.textContent?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  return headers ? `Scrollable table: ${headers.slice(0, 96)}` : "Scrollable table in message";
}

function envelopeBody(body: string) {
  const match = body.match(/CAIRN_ENVELOPE_BEGIN\s*([\s\S]*?)\s*CAIRN_ENVELOPE_END/);
  if (!match) return body;
  try {
    const value = JSON.parse(match[1]) as { summary?: string; deliverable?: string };
    return [value.summary, value.deliverable].filter(Boolean).join("\n\n") || "Completed work.";
  } catch {
    return body;
  }
}

function prettyJson(body: string) {
  const value = body.trim();
  if (!value.startsWith("{") && !value.startsWith("[")) return null;
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return null; }
}
