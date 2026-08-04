import type { ChatMessage } from "./types";

export function reconcileOptimisticMessages(serverMessages: ChatMessage[], optimistic: ChatMessage[]) {
  const unresolved = new Map(optimistic.map((message) => [message.submissionId || message.id, message]));
  for (const message of serverMessages) {
    const overlay = optimistic.find((candidate) => sameSubmission(candidate, message));
    if (overlay) unresolved.delete(overlay.submissionId || overlay.id);
  }
  return {
    messages: [...serverMessages, ...unresolved.values()],
    unresolved: [...unresolved.values()],
  };
}

function sameSubmission(left: ChatMessage, right: ChatMessage) {
  return left.id === right.id || Boolean(left.submissionId && left.submissionId === right.submissionId);
}
