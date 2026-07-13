export type AgentStatus = "idle" | "working" | "failed" | "budget-exhausted";

export interface Agent {
  id: string;
  role: string;
  status: AgentStatus;
  topic?: string;
  updatedAt: string;
}

export interface QueueItem {
  id: string;
  title: string;
  meta: string;
  status: string;
  content?: string;
}

export interface Activity {
  id: number;
  agent: string;
  summary: string;
  status: string;
  completedAt: string;
  chatId: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  recipient: string;
  body: string;
  status: string;
  timestamp: string;
  direction: "incoming" | "outgoing";
  kind: "message" | "assistant" | "tool" | "session" | "turn";
  title?: string;
}

export interface Project {
  id: string;
  name: string;
  root: string;
  agents: Agent[];
  workItems: QueueItem[];
  todos: QueueItem[];
  activity: Activity[];
  conversations: Record<string, ChatMessage[]>;
  workDir?: string;
  releases: number;
}
