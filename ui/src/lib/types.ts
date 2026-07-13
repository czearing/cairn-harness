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
}

export interface Activity {
  id: number;
  agent: string;
  summary: string;
  status: string;
  completedAt: string;
}

export interface Project {
  id: string;
  name: string;
  root: string;
  agents: Agent[];
  workItems: QueueItem[];
  todos: QueueItem[];
  activity: Activity[];
  releases: number;
}
