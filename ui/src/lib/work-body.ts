import type { QueueItem } from "./types";

export function workBody(item: QueueItem) {
  const lines = (item.content || "").split(/\r?\n/);
  while (lines.length && (!lines[0].trim() || /^[a-z_-]+:\s/i.test(lines[0]))) lines.shift();
  return lines
    .join(" ")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim() || "Empty task";
}
