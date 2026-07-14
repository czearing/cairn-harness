import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/types";
import styles from "./MessageBody.module.css";

export function MessageBody({ message }: { message: ChatMessage }) {
  const body = envelopeBody(message.body);
  if (message.kind === "tool") {
    return <details className={styles.details}>
      <summary>Show details</summary>
      <FormattedBody body={body} />
    </details>;
  }
  return <FormattedBody body={body} />;
}

function FormattedBody({ body }: { body: string }) {
  const json = prettyJson(body);
  if (json) return <pre className={styles.code}><code>{json}</code></pre>;
  return <div className={styles.markdown}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}
    >
      {body}
    </ReactMarkdown>
  </div>;
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
