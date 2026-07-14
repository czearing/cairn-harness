export function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function scrollBottom(element: HTMLElement | Window | null) {
  if (element instanceof HTMLElement) element.scrollTop = element.scrollHeight;
  else element?.scrollTo({ top: document.documentElement.scrollHeight });
}
export function formatTime(value: string) {
  return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
}
