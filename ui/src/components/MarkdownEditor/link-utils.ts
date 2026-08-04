const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

export function normalizeUrl(value: string) {
  const url = value.trim();
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return url;
  return `https://${url}`;
}

export function isSafeUrl(value: string) {
  const url = value.trim();
  if (!url) return false;
  if (url.startsWith("/") || url.startsWith("#")) return true;
  try {
    return allowedProtocols.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
