import type { ModelCatalogEntry } from "./model-catalog";
import { writeProjectConfig } from "./project-config-write";

export interface ConfigRole {
  name: string;
  title?: string;
  agent_kind?: "source" | "local";
  source_agent?: string;
  instance_ordinal?: number;
  template?: string;
  capabilities?: string[];
  replica_eligible?: boolean;
  description: string;
  prompt: string;
  model?: string;
  appearance?: { color?: string; avatar?: string };
}

export function migrateAgentRelationships(config: ModelProjectConfig) {
  const roles = config.roles || [];
  let changed = false;
  for (const role of roles) {
    if (role.agent_kind && role.source_agent && role.instance_ordinal !== undefined) continue;
    const legacySource = role.template?.trim();
    if (role.replica_eligible && legacySource && legacySource !== role.name) {
      role.agent_kind = "local";
      role.source_agent = legacySource;
      const suffix = role.name.match(/-(\d+)$/);
      role.instance_ordinal = suffix ? Number(suffix[1]) : 1;
    } else {
      role.agent_kind = "source";
      role.source_agent = role.name;
      role.instance_ordinal = 0;
    }
    changed = true;
  }
  return changed;
}

export interface ModelProjectConfig {
  roles?: ConfigRole[];
  copilot?: { model?: string; [key: string]: unknown };
}

export function migrateLegacyProjectModel(file: string, config: ModelProjectConfig) {
  const legacy = config.copilot?.model;
  if (typeof legacy !== "string" || !legacy.trim()) return false;
  for (const role of config.roles || []) {
    role.model ||= legacy;
  }
  delete config.copilot!.model;
  if (!Object.keys(config.copilot!).length) delete config.copilot;
  writeProjectConfig(file, config);
  return true;
}

export function validateModelOverride(model: unknown, catalog: ModelCatalogEntry[]) {
  if (model === undefined || model === null || model === "") return undefined;
  if (typeof model !== "string" || !catalog.some((candidate) => candidate.id === model)) {
    throw new Error(`Model "${String(model)}" is not available`);
  }
  return model;
}
