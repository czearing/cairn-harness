import type { ChatMessage } from "./types";

export function reconcileOptimisticMessages(serverMessages: ChatMessage[], optimistic: ChatMessage[]) {
  const unresolved = new Map(optimistic.map((message) => [message.submissionId || message.id, message]));
  for (const message of serverMessages) {
    const overlay = optimistic.find((candidate) => sameSubmission(candidate, message));
    if (overlay) unresolved.delete(overlay.submissionId || overlay.id);
  }
  // The conversation is paged, so a message sent earlier eventually falls outside the newest
  // page. Its overlay would then never meet its server copy again and got spliced back in by
  // timestamp, putting the user's own message at the top of the window as if it had just been
  // resent. Once the server's oldest visible message is newer than an overlay, the server has
  // demonstrably moved past it, so the overlay has done its job. A message that failed to send
  // has no server copy to wait for and must survive so the user can still retry it.
  const horizon = serverMessages[0]?.timestamp;
  if (horizon) {
    for (const [key, message] of unresolved) {
      if (message.timestamp < horizon && message.uiStatus !== "failed") unresolved.delete(key);
    }
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
