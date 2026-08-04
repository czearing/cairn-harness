import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Agent, ChatMessage } from "@/lib/types";

interface LiveResponseDocument {
  sessionId: string;
  body: string;
  updatedAt: string;
}

export function readLiveResponse(root: string, agent: Agent): ChatMessage | undefined {
  if (agent.status !== "working") return undefined;
  const file = path.join(root, ".cairn-harness", "live-responses", `${agent.id}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const document = JSON.parse(readFileSync(file, "utf8")) as Partial<LiveResponseDocument>;
    if (!valid(document) || Date.parse(document.updatedAt) < Date.parse(agent.updatedAt)) {
      return undefined;
    }
    return {
      id: `live:${agent.id}:${document.sessionId}`,
      sender: agent.id,
      recipient: "team",
      body: document.body,
      status: "streaming",
      timestamp: document.updatedAt,
      direction: "outgoing",
      kind: "assistant",
      title: "Live response",
      live: true,
    };
  } catch {
    return undefined;
  }
}

function valid(document: Partial<LiveResponseDocument>): document is LiveResponseDocument {
  return typeof document.sessionId === "string"
    && Boolean(document.sessionId)
    && typeof document.body === "string"
    && Boolean(document.body.trim())
    && typeof document.updatedAt === "string"
    && Number.isFinite(Date.parse(document.updatedAt));
}
