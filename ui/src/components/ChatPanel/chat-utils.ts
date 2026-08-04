export function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function scrollBottom(element: HTMLElement | Window | null) {
  if (element instanceof HTMLElement) element.scrollTop = element.scrollHeight;
  else element?.scrollTo({ top: document.documentElement.scrollHeight });
}
export function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function exactTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "long" }).format(date);
}

export function localDay(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : value;
}

export function dayLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = localDay(now.toISOString());
  if (localDay(value) === today) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (localDay(value) === localDay(yesterday.toISOString())) return "Yesterday";
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
}

export function chatGroupPosition(messages: ChatMessage[], index: number, breakBefore = false, breakAfter = false) {
  const before = !breakBefore && grouped(messages[index - 1], messages[index]);
  const after = !breakAfter && grouped(messages[index], messages[index + 1]);
  if (before && after) return "middle";
  if (before) return "end";
  if (after) return "start";
  return "single";
}

export function chatStartsDay(messages: ChatMessage[], index: number) {
  return index === 0 || localDay(messages[index - 1].timestamp) !== localDay(messages[index].timestamp);
}

export function conversationUnitCount(messages: ChatMessage[]) {
  let total = 0;
  messages.forEach((message, index) => {
    if (message.kind !== "tool" || !sameToolRun(messages[index - 1], message)) total += 1;
  });
  return total;
}

export function hasTruthfulWorkingIndicator(agent: Agent, messages: ChatMessage[], now = Date.now()) {
  const unresolved = [...messages].reverse().find((message, index, reversed) => {
    if (!isOperatorMessage(message)) return false;
    const later = reversed.slice(0, index);
    return !later.some((candidate) => candidate.sender === agent.id && (candidate.kind === "assistant" || candidate.kind === "turn"));
  });
  if (!unresolved) return false;
  if (messageDeliveryState(unresolved) === "working") return true;
  if (agent.status !== "working" || agent.topic !== "dashboard-message") return false;
  const updated = Date.parse(agent.updatedAt);
  return updated >= Date.parse(unresolved.timestamp) && now - updated <= 90_000;
}

export function chatMessageStatus(message: ChatMessage) {
  return messageStateLabel(message);
}

function ordinary(message?: ChatMessage) {
  return message?.kind === "message" || message?.kind === "assistant";
}

function grouped(left?: ChatMessage, right?: ChatMessage) {
  if (!left || !right || !ordinary(left) || !ordinary(right) || left.sender !== right.sender || localDay(left.timestamp) !== localDay(right.timestamp)) return false;
  return Date.parse(right.timestamp) - Date.parse(left.timestamp) <= 5 * 60_000;
}

function sameToolRun(left?: ChatMessage, right?: ChatMessage) {
  return left?.kind === "tool" && right?.kind === "tool" && left.sender === right.sender;
}

function isOperatorMessage(message: ChatMessage) {
  return (message.sender === "dashboard" || message.sender === "human") && message.kind === "message";
}
import type { Agent, ChatMessage } from "../../lib/types";
import { messageDeliveryState, messageStateLabel } from "../../lib/message-lifecycle.ts";
