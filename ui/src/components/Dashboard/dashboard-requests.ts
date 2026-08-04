export interface PostJsonResult {
  id?: string;
  status?: string;
  workerStarted?: boolean;
  workerError?: string;
}

export async function postJson(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(data.error || "Request failed");
  }
  return response.json().catch(() => ({})) as Promise<PostJsonResult>;
}

export function submissionWarning(result: PostJsonResult) {
  if (result.workerStarted !== false || !result.workerError) return;
  return `Submission saved, but agents did not start. ${result.workerError} Open system status to restart agents.`;
}

export interface AutomationSaveResult {
  persisted: true;
  workerError?: string;
}

export async function putAutomation(
  url: string,
  body: object,
  request: typeof fetch = fetch,
): Promise<AutomationSaveResult> {
  const response = await request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { error?: string; persisted?: boolean };
  if (!response.ok) {
    if (data.persisted === true) return { persisted: true, workerError: data.error || "Automation restart failed" };
    throw new Error(data.error || "Save failed");
  }
  return { persisted: true };
}

export function automationWarning(result: AutomationSaveResult) {
  if (!result.workerError) return;
  return `Automation settings saved, but agents did not restart. ${result.workerError} Open system status to restart agents.`;
}

export async function writeJson(url: string, method: string, body?: object, options: { expectedRevision?: number } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.expectedRevision === undefined ? {} : { "if-match": `"${options.expectedRevision}"` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({})) as { error?: string; code?: string; latestRevision?: number; revision?: number };
  if (!response.ok) {
    throw Object.assign(new Error(data.error || "Save failed"), {
      code: data.code,
      latestRevision: data.latestRevision,
    });
  }
  return data;
}
