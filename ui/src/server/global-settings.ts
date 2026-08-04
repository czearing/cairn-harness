import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getModelCatalog } from "./model-catalog";
import { writeProjectConfig } from "./project-config-write";

export const fallbackDefaultModel = "gpt-5.4-mini";

export interface GlobalSettings {
  defaultModel: string;
}

export function globalSettingsPath() {
  return process.env.HARNESS_GLOBAL_SETTINGS
    || path.join(process.env.HARNESS_PROJECT_ROOT || path.join(/* turbopackIgnore: true */ process.cwd(), "..", "projects"), "settings.json");
}

export function readGlobalSettings(): GlobalSettings {
  const file = globalSettingsPath();
  if (!existsSync(file)) return { defaultModel: fallbackDefaultModel };
  const value = JSON.parse(readFileSync(file, "utf8")) as { defaultModel?: unknown };
  if (typeof value.defaultModel !== "string" || !value.defaultModel.trim()) {
    throw new Error("Global settings do not contain a valid default model");
  }
  return { defaultModel: value.defaultModel };
}

export async function writeGlobalSettings(defaultModel: string) {
  const model = defaultModel.trim();
  const catalog = await getModelCatalog();
  if (!catalog.some((candidate) => candidate.id === model)) {
    throw new Error(`Model "${model}" is not available`);
  }
  const file = globalSettingsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeProjectConfig(file, { defaultModel: model });
  return { defaultModel: model };
}
