import type { TaskCanonicalStatus } from "./task-status";

export type AgentStatus = "idle" | "working" | "paused" | "failed" | "budget-exhausted";

export interface Agent {
  id: string;
  kind?: "source" | "local";
  sourceAgentId?: string;
  instanceOrdinal?: number;
  legacyOverrides?: string[];
  configurationRevision?: number;
  appearance?: { color?: string; avatar?: string };
  capabilities?: {
    configure: boolean;
    pause: boolean;
    resume: boolean;
    reset: boolean;
    delete: boolean;
    promote: boolean;
  };
  title?: string;
  role: string;
  status: AgentStatus;
  topic?: string;
  updatedAt: string;
  lastMessage?: string;
  lastMessageAt?: string;
  prompt?: string;
  model?: string;
  isLeader?: boolean;
  isIdeaAgent?: boolean;
}

export interface IdeaAgent {
  agentId: string;
  taskLimit: number;
  prompt: string;
  activeTaskCount: number;
}

export interface QueueItem {
  id: string;
  title: string;
  meta: string;
  status: string;
  rawStatus?: string;
  canonicalStatus?: TaskCanonicalStatus;
  statusLabel?: string;
  taskKind?: "root" | "delegation";
  parentId?: string;
  accountableId?: string;
  executorId?: string;
  content?: string;
  agentId?: string;
  chatId?: string;
  context?: string;
  updatedAt?: string;
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
  submissionId?: string;
  uiStatus?: "sending" | "failed";
  workerStarted?: boolean;
  workerError?: string;
  deliveryState?: MessageDeliveryState;
  error?: string;
  replyToId?: string;
  activity?: SafeActivity;
  live?: boolean;
}

export type MessageDeliveryState = "sending" | "queued" | "delivered" | "working" | "replied" | "failed";

export interface SafeActivity {
  phase: string;
  tool?: string;
  target?: string;
  command?: string;
}

export interface ConversationPage {
  items: ChatMessage[];
  hasMore: boolean;
  nextBefore?: string;
}

export interface HealthIssue { projectId: string; projectName: string; summary: string; transcript: string; }
export interface HealthState { status: "healthy" | "paused" | "attention"; label: string; issues: HealthIssue[]; }

export interface Project {
  id: string;
  name: string;
  root: string;
  agents: Agent[];
  workItems: QueueItem[];
  delegatedActions: QueueItem[];
  activity: Activity[];
  conversations?: Record<string, ChatMessage[]>;
  workDir?: string;
  paused?: boolean;
  leaderTaskLimit?: number;
  maxActiveTasks?: number;
  delegatedTaskCount?: number;
  backlogTaskCount?: number;
  ideaAgents?: IdeaAgent[];
  releases: number;
  workItemCount?: number;
  activeWorkCount?: number;
  drafts?: QueueItem[];
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
}

export interface ModelSettings {
  defaultModel: string;
  models: ModelOption[];
  catalog: ModelCatalogState;
}

export type ModelCatalogErrorCode = "copilot-not-found" | "timeout" | "empty" | "discovery-failed";

export type ModelCatalogState =
  | { status: "ready" }
  | { status: "error"; code: ModelCatalogErrorCode; message: string; detail?: string };
