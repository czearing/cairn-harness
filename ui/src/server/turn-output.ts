export interface TurnOutput {
  summary?: string;
  deliverable?: string;
}

export function parseTurnOutput(value: unknown): { output: TurnOutput; malformed: boolean } {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { output: {}, malformed: true };
    const record = parsed as Record<string, unknown>;
    const summary = optionalString(record.summary);
    const deliverable = optionalString(record.deliverable);
    const malformed = invalidOptionalString(record.summary) || invalidOptionalString(record.deliverable);
    return { output: { summary, deliverable }, malformed };
  } catch {
    return { output: {}, malformed: true };
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function invalidOptionalString(value: unknown) {
  return value !== undefined && value !== null && typeof value !== "string";
}
