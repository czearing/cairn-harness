import { agentColor } from "./colors";

export function agentAppearanceKey(projectId: string, agentId: string) {
  return JSON.stringify([projectId, agentId]);
}

export function agentAppearanceOverride(values: Record<string, string>, projectId: string, agentId: string) {
  const scopedKey = agentAppearanceKey(projectId, agentId);
  return Object.hasOwn(values, scopedKey) ? values[scopedKey] : values[agentId];
}

export function projectAgentColor(values: Record<string, string>, projectId: string, agentId: string) {
  return agentAppearanceOverride(values, projectId, agentId) || agentColor(agentId);
}

export function updateAgentAppearance(
  values: Record<string, string>,
  projectId: string,
  agentId: string,
  value?: string,
) {
  const next = { ...values };
  const scopedKey = agentAppearanceKey(projectId, agentId);
  if (value) next[scopedKey] = value;
  else delete next[scopedKey];
  return next;
}
