import { spawn } from "node:child_process";
import { copilotInvocation } from "./copilot-command";

export interface ModelCatalogEntry {
  id: string;
  name: string;
  description?: string;
}

export type ModelCatalogErrorCode = "copilot-not-found" | "timeout" | "empty" | "discovery-failed";

export class ModelCatalogError extends Error {
  code: ModelCatalogErrorCode;
  detail?: string;

  constructor(code: ModelCatalogErrorCode, message: string, detail?: string) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

interface CatalogMessage {
  id?: number;
  result?: {
    models?: {
      availableModels?: Array<{ modelId?: unknown; name?: unknown; description?: unknown }>;
    };
  };
}

let cachedCatalog: Promise<ModelCatalogEntry[]> | undefined;

export function getModelCatalog() {
  const configured = process.env.HARNESS_MODEL_CATALOG;
  if (configured) return Promise.resolve(parseConfiguredCatalog(configured));
  cachedCatalog ||= discoverModelCatalog().catch((error) => {
    cachedCatalog = undefined;
    throw error;
  });
  return cachedCatalog;
}

function parseConfiguredCatalog(value: string): ModelCatalogEntry[] {
  const catalog = JSON.parse(value) as unknown;
  if (!Array.isArray(catalog)) throw new Error("Configured model catalog must be an array");
  const models = catalog.flatMap((model) => (
    typeof model === "object"
    && model !== null
    && typeof (model as { id?: unknown }).id === "string"
    && typeof (model as { name?: unknown }).name === "string"
      ? [{
          id: (model as { id: string }).id,
          name: (model as { name: string }).name,
          description: typeof (model as { description?: unknown }).description === "string"
            ? (model as { description: string }).description
            : undefined,
        }]
      : []
  ));
  if (models.length !== catalog.length || !models.length) {
    throw new Error("Configured model catalog contains invalid entries");
  }
  return models;
}

export function parseModelCatalogMessage(line: string): ModelCatalogEntry[] | undefined {
  let message: CatalogMessage;
  try {
    message = JSON.parse(line) as CatalogMessage;
  } catch {
    return undefined;
  }
  if (message.id !== 2) return undefined;
  const models = message.result?.models?.availableModels;
  if (!Array.isArray(models)) throw new Error("Copilot did not return a model catalog");
  const catalog = models.flatMap((model) => (
    typeof model.modelId === "string" && typeof model.name === "string"
      ? [{ id: model.modelId, name: model.name, description: typeof model.description === "string" ? model.description : undefined }]
      : []
  ));
  if (!catalog.length) throw new ModelCatalogError("empty", "Copilot returned an empty model catalog");
  return catalog;
}

async function discoverModelCatalog(): Promise<ModelCatalogEntry[]> {
  return new Promise((resolve, reject) => {
    const invocation = copilotInvocation();
    const child = spawn(invocation.command, [...invocation.args, "--acp", "--no-color"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let initialized = false;
    let settled = false;
    const finish = (error?: Error, catalog?: ModelCatalogEntry[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(catalog || []);
    };
    const timer = setTimeout(() => finish(new ModelCatalogError("timeout", "Timed out while loading the Copilot model catalog")), 15_000);
    child.on("error", (error: NodeJS.ErrnoException) => finish(error.code === "ENOENT"
      ? new ModelCatalogError("copilot-not-found", "The Copilot CLI could not be started", error.message)
      : new ModelCatalogError("discovery-failed", "Could not start Copilot model discovery", error.message)));
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: { id?: number };
        try { message = JSON.parse(line) as { id?: number }; } catch { continue; }
        if (message.id === 1 && !initialized) {
          initialized = true;
          child.stdin.write(`${JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: process.cwd(), mcpServers: [] },
          })}\n`);
        }
        try {
          const catalog = parseModelCatalogMessage(line);
          if (catalog) finish(undefined, catalog);
        } catch (error) {
          finish(error instanceof ModelCatalogError
            ? error
            : new ModelCatalogError("discovery-failed", "Could not parse Copilot model catalog", error instanceof Error ? error.message : undefined));
        }
      }
    });
    child.on("exit", (code) => {
      if (!settled) {
        const detail = `Copilot model discovery exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`;
        finish(new ModelCatalogError("discovery-failed", "Copilot model discovery failed", detail));
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      },
    })}\n`);
  });
}

export function modelCatalogError(error: unknown) {
  if (error instanceof ModelCatalogError) {
    return { status: "error" as const, code: error.code, message: error.message, detail: error.detail };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { status: "error" as const, code: "discovery-failed" as const, message: "Could not load model catalog", detail };
}
