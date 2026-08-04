import type { Agent, ChatMessage, MessageDeliveryState } from "./types";

export function persistedMessageState(
  status: string,
  agent?: Pick<Agent, "status" | "topic">,
): MessageDeliveryState | undefined {
  const normalized = status.toLowerCase();
  if (normalized === "failed" || normalized === "cancelled") return "failed";
  if (["completed", "done", "released"].includes(normalized)) return "replied";
  if (normalized === "claimed") {
    return agent?.status === "working" && agent.topic === "dashboard-message"
      ? "working"
      : "delivered";
  }
  if (["running", "working", "in-progress"].includes(normalized)) return "working";
  if (["pending", "queued", "deferred", "backlog"].includes(normalized)) return "queued";
  return undefined;
}

export function messageDeliveryState(message: ChatMessage): MessageDeliveryState | undefined {
  if (message.uiStatus === "sending") return "sending";
  if (message.uiStatus === "failed") return "failed";
  return message.deliveryState || persistedMessageState(message.status);
}

export function messageStateLabel(message: ChatMessage) {
  switch (messageDeliveryState(message)) {
    case "sending": return "Sending";
    case "queued": return message.workerStarted === false && message.workerError
      ? "Queued, agents not running"
      : "Queued";
    case "delivered": return "Delivered to agent session";
    case "working": return "Working";
    case "replied": return "Replied";
    case "failed": return "Failed";
    default: return message.status;
  }
}

export function submissionIdFromTask(id: string) {
  const value = id.replace(/^task:/, "");
  return value.startsWith("dashboard-message-")
    ? value.slice("dashboard-message-".length)
    : undefined;
}
