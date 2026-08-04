import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqlite.ts";
import { getProjectConfigPath } from "./projects";
import { restartProject } from "./supervisor";
import { applyAutomationConfig } from "./automation-policy";
import type { AutomationSettings } from "./automation-policy";
import { writeProjectConfig } from "./project-config-write";
import { configureManualRootCapacity } from "./root-task-admission";

interface AutomationMutationDependencies {
  restartProject: typeof restartProject;
}

export interface AutomationUpdateResult {
  persisted: true;
  restartError?: string;
}

export function updateAutomation(
  projectId: string,
  settings: AutomationSettings,
  dependencies: AutomationMutationDependencies = { restartProject },
): AutomationUpdateResult {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    root?: string;
    leader?: string;
    leader_task_limit?: number;
    max_active_tasks?: number;
    idea_agents?: { agent: string; task_limit: number; prompt: string }[];
    producer?: string; producer_limit?: number; producer_prompt?: string;
    roles?: { name: string }[];
  };
  applyAutomationConfig(config, settings);
  writeProjectConfig(configPath, config);
  const databasePath = path.join(path.resolve(path.dirname(configPath), config.root || "."), ".cairn-harness", "harness.db");
  if (existsSync(databasePath)) {
    const db = openDatabase(databasePath);
    try {
      configureManualRootCapacity(db, config.leader || config.roles?.[0]?.name || "", settings.maxActiveTasks);
    } finally {
      db.close();
    }
  }
  try {
    dependencies.restartProject(projectId);
    return { persisted: true };
  } catch (error) {
    return {
      persisted: true,
      restartError: error instanceof Error ? error.message : "Automation restart failed",
    };
  }
}

