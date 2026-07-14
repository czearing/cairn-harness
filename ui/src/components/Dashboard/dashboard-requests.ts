export async function postJson(url: string, body: object, mutate: () => Promise<unknown>) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(data.error || "Request failed");
  }
  await mutate();
  return response.json().catch(() => ({})) as Promise<{ id?: string }>;
}

export async function writeJson(url: string, method: string, body?: object) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Save failed" })) as { error?: string };
    throw new Error(data.error || "Save failed");
  }
}
