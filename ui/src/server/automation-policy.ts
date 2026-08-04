interface AutomationConfig {
  leader?: string;
  leader_task_limit?: number;
  max_active_tasks?: number;
  idea_agents?: { agent: string; task_limit: number; prompt: string }[];
  producer?: string;
  producer_limit?: number;
  producer_prompt?: string;
  roles?: { name: string }[];
}

export interface AutomationSettings {
  maxActiveTasks?: number;
  ideaAgents: { agentId: string; taskLimit: number; prompt: string }[];
}

export function applyAutomationConfig(config: AutomationConfig, settings: AutomationSettings) {
  if (settings.maxActiveTasks !== undefined
    && (!Number.isInteger(settings.maxActiveTasks) || settings.maxActiveTasks < 1)) {
    throw new Error("Maximum active tasks must be at least one");
  }
  const roles = new Set((config.roles || []).map((role) => role.name));
  const seen = new Set<string>();
  for (const idea of settings.ideaAgents) {
    if (!roles.has(idea.agentId)) throw new Error("Idea agent not found");
    if (seen.has(idea.agentId)) throw new Error("Idea agents must be unique");
    if (idea.agentId === config.leader) throw new Error("Project leader cannot also be an idea agent");
    if (!Number.isInteger(idea.taskLimit) || idea.taskLimit < 1) throw new Error("Idea agent task limit must be at least one");
    if (!idea.prompt.trim()) throw new Error("Idea agent prompt is required");
    seen.add(idea.agentId);
  }
  delete config.leader_task_limit;
  if (settings.maxActiveTasks === undefined) delete config.max_active_tasks;
  else config.max_active_tasks = settings.maxActiveTasks;
  config.idea_agents = settings.ideaAgents.map((idea) => ({
    agent: idea.agentId,
    task_limit: idea.taskLimit,
    prompt: idea.prompt.trim(),
  }));
  delete config.producer;
  delete config.producer_limit;
  delete config.producer_prompt;
}
