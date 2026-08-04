import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { ChatMessage } from "@/lib/types";
import { ChatVirtualHistory } from "@/components/ChatPanel/ChatVirtualHistory";
import { sameToolRun, toolRun } from "@/components/ChatPanel/ChatMessageView";

const messages = Array.from({ length: 10_000 }, (_, index): ChatMessage => ({
  id: `scale-${index}`,
  sender: toolIndex(index) ? "writer" : index % 2 === 0 ? "dashboard" : "writer",
  recipient: toolIndex(index) ? "tool" : index % 2 === 0 ? "writer" : "dashboard",
  body: toolIndex(index) ? `Command ${index - 9_899}: completed successfully.` : body(index),
  status: "completed",
  timestamp: new Date(1_767_225_600_000 + index * 60_000).toISOString(),
  direction: index % 2 === 0 ? "incoming" : "outgoing",
  kind: toolIndex(index) ? "tool" : index % 2 === 0 ? "message" : "assistant",
}));

function Fixture() {
  return <main className="fixture">
    <output data-loaded-count={messages.length} hidden />
    <ChatVirtualHistory
      agentId="writer"
      messages={messages}
      renderItem={(message, index) => {
        if (message.kind === "tool" && sameToolRun(message, messages[index + 1])) {
          return <div className="tool-continuation" />;
        }
        if (message.kind === "tool") {
          const tools = toolRun(messages, index);
          return <article className="tool-group">
            {tools.map((tool) => <span key={tool.id} data-chat-id={tool.id} />)}
            <strong>Tools used ({tools.length})</strong>
          </article>;
        }
        return <article data-chat-id={message.id} className={message.sender === "dashboard" ? "bubble own" : "bubble"}>
          <strong>{message.sender === "dashboard" ? "You" : "Agent"}</strong>
          <p>{message.body}</p>
        </article>;
      }}
    />
  </main>;
}

function body(index: number) {
  const lines = index % 13 === 0 ? 12 : index % 7 === 0 ? 5 : index % 3 + 1;
  return Array.from({ length: lines }, (_, line) =>
    `Message ${index + 1}, line ${line + 1}. Variable-height history keeps one stable geometry model.`,
  ).join(index % 5 === 0 ? "\n\n" : " ");
}

function toolIndex(index: number) {
  return index >= 9_900 && index <= 9_976;
}

const style = document.createElement("style");
style.textContent = `
  * { box-sizing: border-box; }
  html, body, #root { width: 100%; height: 100%; margin: 0; }
  body { background: #111418; color: #e8ebef; font: 13px system-ui, sans-serif; }
  #root { padding: 24px; }
  .fixture { display: flex; width: 100%; height: 100%; }
  .bubble { width: min(74%, 34rem); margin: 6px 2px; padding: 10px 12px; border-radius: 18px; background: #252a31; }
  .bubble.own { margin-left: auto; background: #25364d; }
  .tool-continuation { height: 1px; }
  .tool-group { position: relative; height: 58px; margin: 6px 2px; padding: 18px 12px; border: 1px solid #343a43; }
  .tool-group > span { position: absolute; inset: 0; pointer-events: none; }
  strong { display: block; margin-bottom: 5px; font-size: 10px; }
  p { margin: 0; white-space: pre-wrap; line-height: 18px; overflow-wrap: anywhere; }
`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
