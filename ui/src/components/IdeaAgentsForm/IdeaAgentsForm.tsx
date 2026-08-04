"use client";

import { Button } from "@/components/Button/Button";
import { Checkbox, FieldMessage, FormField, Input, Textarea } from "@/components/FormField/FormField";

import { useState } from "react";
import type { IdeaAgent, Project } from "@/lib/types";
import styles from "../AutomationForm/AutomationForm.module.css";

export interface IdeaAgentsDraft {
  ideaAgents: Pick<IdeaAgent, "agentId" | "taskLimit" | "prompt">[];
}

export function IdeaAgentsForm({ project, onSave, onCancel }: {
  project: Project; onSave: (draft: IdeaAgentsDraft) => Promise<void>; onCancel: () => void;
}) {
  const leader = project.agents.find((agent) => agent.isLeader);
  const available = project.agents.filter((agent) => !agent.isLeader);
  const [ideaAgents, setIdeaAgents] = useState<IdeaAgentsDraft["ideaAgents"]>(
    (project.ideaAgents || []).filter((idea) => idea.agentId !== leader?.id)
      .map(({ agentId, taskLimit, prompt }) => ({ agentId, taskLimit, prompt })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  function update(agentId: string, patch: Partial<IdeaAgentsDraft["ideaAgents"][number]>) {
    setIdeaAgents((current) => current.map((idea) => idea.agentId === agentId ? { ...idea, ...patch } : idea));
  }
  function toggle(agentId: string, enabled: boolean) {
    setIdeaAgents((current) => enabled
      ? [...current, { agentId, taskLimit: 3, prompt: "Create a new task for this project." }]
      : current.filter((idea) => idea.agentId !== agentId));
  }
  async function save() {
    setSaving(true);
    setError(undefined);
    try { await onSave({ ideaAgents }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed"); }
    finally { setSaving(false); }
  }
  return <div className={styles.form}>
    <section className={styles.section}>
      <fieldset><legend>Idea agents</legend>{available.map((agent) => {
        const idea = ideaAgents.find((value) => value.agentId === agent.id);
        return <div className={styles.idea} key={agent.id}>
          <Checkbox checked={Boolean(idea)} onChange={(event) => toggle(agent.id, event.target.checked)}>{agent.title || agent.id}</Checkbox>
          {idea && <><FormField label="Maximum active tasks" description="Caps concurrent work created by this idea agent."><Input type="number" min={1} max={1000} value={idea.taskLimit} onChange={(event) => update(agent.id, { taskLimit: Number(event.target.value) })} /></FormField>
            <FormField label="Creation prompt" description="Tell this agent what useful project work to discover."><Textarea value={idea.prompt} onChange={(event) => update(agent.id, { prompt: event.target.value })} /></FormField></>}
        </div>;
      })}</fieldset>
      {!available.length && <p>Create a non-leader agent before enabling automatic ideas.</p>}
    </section>
    {error && <FieldMessage tone="error">{error}</FieldMessage>}
    <footer><Button variant="secondary" className={styles.secondary} onClick={onCancel}>Cancel</Button><span /><Button variant="primary" disabled={saving || ideaAgents.some((idea) => idea.taskLimit < 1 || !idea.prompt.trim())} onClick={() => void save()}>{saving ? "Saving" : "Save"}</Button></footer>
  </div>;
}
