export class ConversationPrefetchCache<T> {
  readonly #entries = new Map<string, T>();
  readonly limit: number;

  constructor(limit = 32) {
    this.limit = limit;
  }

  get size() {
    return this.#entries.size;
  }

  get(url: string) {
    const value = this.#entries.get(url);
    if (value === undefined) return undefined;
    this.#entries.delete(url);
    this.#entries.set(url, value);
    return value;
  }

  set(url: string, value: T) {
    if (!isCanonicalConversationFirstPage(url)) return;
    this.#entries.delete(url);
    this.#entries.set(url, value);
    while (this.#entries.size > this.limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) return;
      this.#entries.delete(oldest);
    }
  }
}

export class InFlightRequests<T> {
  readonly #requests = new Map<string, Promise<T>>();

  has(url: string) {
    return this.#requests.has(url);
  }

  run(url: string, load: () => Promise<T>) {
    const pending = this.#requests.get(url);
    if (pending) return pending;
    const request = load().finally(() => {
      if (this.#requests.get(url) === request) this.#requests.delete(url);
    });
    this.#requests.set(url, request);
    return request;
  }
}

export function isCanonicalConversationFirstPage(url: string) {
  const parsed = new URL(url, "http://localhost");
  const keys = [...parsed.searchParams.keys()];
  return isConversationFirstPage(url)
    && keys.every((key) => key === "agent" || key === "limit")
    && Boolean(parsed.searchParams.get("agent"));
}

export function isConversationFirstPage(url: string) {
  const parsed = new URL(url, "http://localhost");
  return /^\/api\/projects\/[^/]+\/messages$/.test(parsed.pathname)
    && Boolean(parsed.searchParams.get("agent"))
    && !parsed.searchParams.has("before");
}
