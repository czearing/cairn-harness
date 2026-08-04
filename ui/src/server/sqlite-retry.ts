const retryablePrimaryCodes = new Set([5, 6, 10]);
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

export function withSqliteRetry<T>(
  operation: () => T,
  attempts = 5,
  delayMs = 50,
): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt >= attempts || !isRetryableSqliteError(error)) throw error;
      Atomics.wait(waitBuffer, 0, 0, delayMs);
    }
  }
}

function isRetryableSqliteError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const sqlite = error as Error & { errcode?: number; errstr?: string };
  if (typeof sqlite.errcode === "number") {
    return retryablePrimaryCodes.has(sqlite.errcode & 0xff);
  }
  return sqlite.errstr === "disk I/O error";
}
