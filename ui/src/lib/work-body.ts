import type { QueueItem } from "./types";

// A work item's body is only ever shown as a two-line clamped summary, so the server sends a
// bounded preview instead of the whole task document. Falling back to the raw content keeps
// drafts, which legitimately carry their full text, rendering identically.
export function workBody(item: QueueItem) {
  return item.bodyPreview || collapseBody(item.content || "");
}

export function collapseBody(content: string) {
  const lines = content.split(/\r?\n/);
  while (lines.length && (!lines[0].trim() || /^[a-z_-]+:\s/i.test(lines[0]))) lines.shift();
  return lines
    .join(" ")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim() || "Empty task";
}
