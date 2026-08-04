export const EMPTY_STORED_RECORD = Object.freeze({}) as Record<string, string>;

export class StoredRecordSnapshotCache {
  readonly #entries = new Map<string, { raw: string; value: Record<string, string> }>();

  get(key: string, raw: string) {
    const cached = this.#entries.get(key);
    if (cached?.raw === raw) return cached.value;
    const value = parseStoredRecord(raw);
    this.#entries.set(key, { raw, value });
    return value;
  }
}

export function parseStoredRecord(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw || "{}");
  } catch {
    return EMPTY_STORED_RECORD;
  }
  if (!isPlainRecord(value)) return EMPTY_STORED_RECORD;
  if (Object.values(value).some((entry) => typeof entry !== "string")) return EMPTY_STORED_RECORD;
  return value as Record<string, string>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
