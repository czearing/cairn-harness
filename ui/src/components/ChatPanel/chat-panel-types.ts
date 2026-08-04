import type { Agent, ChatMessage } from "@/lib/types";

export interface ChatPanelProps {
  projectId: string; agent: Agent; messages: ChatMessage[]; groupBreakIds?: string[]; colors?: Record<string, string>; avatars?: Record<string, string>; focusId?: string;
  hasMore?: boolean; loading?: boolean; loadingMore?: boolean; olderCount?: number; historyError?: string; retryingHistory?: boolean;
  onLoadOlder?: () => void; onRetryHistory?: () => void; onReturnLatest?: () => void; onSend: (body: string, submissionId: string) => Promise<void>; onRetrySend?: (body: string, submissionId: string) => Promise<void>; onConfigure?: () => void;
}
