import { readFileSync, writeFileSync } from "node:fs";
import { getProjectConfigPath } from "./projects";
import { restartProject } from "./supervisor";

export function updateAutomation(projectId: string, producer?: string, limit?: number) {
  const configPath = getProjectConfigPath(projectId);
  if (!configPath) throw new Error("Project config not found");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { producer?: string; producer_limit?: number; roles?: { name: string }[] };
  if (!producer) {
    delete config.producer;
    delete config.producer_limit;
  } else {
    if (!(config.roles || []).some((role) => role.name === producer)) throw new Error("Producer agent not found");
    if (!Number.isInteger(limit) || !limit || limit < 1) throw new Error("Automatic task limit must be at least one");
    config.producer = producer;
    config.producer_limit = limit;
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  setImmediate(() => {
    try { restartProject(projectId); } catch (error) { console.error("Could not restart project after automation update", error); }
  });
}
