import type { ChatMessage } from "./types";

export function reconcileOptimisticMessages(serverMessages: ChatMessage[], optimistic: ChatMessage[]) {
  const unresolved = new Map(optimistic.map((message) => [message.submissionId || message.id, message]));
  for (const message of serverMessages) {
    const overlay = optimistic.find((candidate) => sameSubmission(candidate, message));
    if (overlay) unresolved.delete(overlay.submissionId || overlay.id);
  }
  const pending = [...unresolved.values()];
  return {
    messages: merge(serverMessages, pending),
    unresolved: pending,
  };
}

// Appending pending messages to the tail placed them below newer server events, so each one visibly
// jumped once the server copy arrived. Splice them in at their own timestamp instead, keeping a
// pending message after any server message sharing that timestamp since it was sent last.
function merge(serverMessages: ChatMessage[], pending: ChatMessage[]) {
  if (!pending.length) return serverMessages;
  const messages = [...serverMessages];
  for (const message of [...pending].sort(byTimestamp)) {
    let index = messages.length;
    while (index > 0 && messages[index - 1].timestamp > message.timestamp) index -= 1;
    messages.splice(index, 0, message);
  }
  return messages;
}

function byTimestamp(left: ChatMessage, right: ChatMessage) {
  return left.timestamp.localeCompare(right.timestamp);
}

function sameSubmission(left: ChatMessage, right: ChatMessage) {
  return left.id === right.id || Boolean(left.submissionId && left.submissionId === right.submissionId);
}
