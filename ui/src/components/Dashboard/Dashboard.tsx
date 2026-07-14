"use client";

import { useState } from "react";
import useSWR from "swr";
import type { HealthState, Project, QueueItem } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { useAgentColors } from "@/lib/use-agent-colors";
import { useStoredRecord } from "@/lib/use-stored-record";
import { useSelectedProject } from "@/lib/use-selected-project";
import { useProjectEvents } from "@/lib/use-project-events";
import { prefetchConversation } from "@/lib/use-conversation";
import { ActionDrawer } from "../ActionDrawer/ActionDrawer";
import { IdentityEditor } from "../AgentIdentityEditor/AgentIdentityEditor";
import { AgentPromptEditor } from "../AgentPromptEditor/AgentPromptEditor";
import { ActivityRail } from "../ActivityRail/ActivityRail";
import { ConversationDrawer } from "../ConversationDrawer/ConversationDrawer";
import { EmptyProject } from "../EmptyProject/EmptyProject";
import { NewProjectForm } from "../NewProjectForm/NewProjectForm";
import { ProjectSidebar } from "../ProjectSidebar/ProjectSidebar";
import { TaskEditor } from "../TaskEditor/TaskEditor";
import { SystemStatus } from "../SystemStatus/SystemStatus";
import { ProjectView } from "../ProjectView/ProjectView";
import styles from "./Dashboard.module.css";

const fetcher = (url: string) => fetch(url).then((response) => response.json());
interface ChatSelection { agentId: string; focusId?: string; }
interface EditorSelection { kind: "draft" | "document"; item: QueueItem; }

export function Dashboard({ initialProjects }: { initialProjects: Project[] }) {
  const { data = initialProjects, mutate } = useSWR<Project[]>("/api/projects", fetcher, { fallbackData: initialProjects });
  const { data: health = healthy, mutate: mutateHealth } = useSWR<HealthState>("/api/health", fetcher, { fallbackData: healthy });
  const [selectedId, setSelectedId] = useSelectedProject(initialProjects[0]?.id);
  const [chat, setChat] = useState<ChatSelection>();
  const [editing, setEditing] = useState<EditorSelection>();
  const [addingProject, setAddingProject] = useState(false);
  const [appearanceId, setAppearanceId] = useState<string>();
  const [projectAppearanceId, setProjectAppearanceId] = useState<string>();
  const [showHealth, setShowHealth] = useState(false);
  const [promptId, setPromptId] = useState<string>();
  const [colors, setColors] = useAgentColors();
  const [avatars, setAvatars] = useStoredRecord("harness-agent-avatars");
  const [projectColors, setProjectColors] = useStoredRecord("harness-project-colors");
  const [projectAvatars, setProjectAvatars] = useStoredRecord("harness-project-avatars");
  const [activityCutoffs, setActivityCutoffs] = useStoredRecord("harness-activity-cutoffs");
  const project = data.find((item) => item.id === selectedId) || data[0];
  const chatAgent = project?.agents.find((agent) => agent.id === chat?.agentId);
  const appearanceAgent = project?.agents.find((agent) => agent.id === appearanceId);
  const appearanceProject = data.find((item) => item.id === projectAppearanceId);
  const promptAgent = project?.agents.find((agent) => agent.id === promptId);
  useProjectEvents(() => { void mutate(); void mutateHealth(); });

  async function post(url: string, body: object) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
      throw new Error(data.error || "Request failed");
    }
    await mutate();
    return response.json().catch(() => ({})) as Promise<{ id?: string }>;
  }
  async function createProject(name: string, roles: string) {
    const result = await post("/api/projects", { name, roles });
    setAddingProject(false);
    if (result.id) setSelectedId(result.id);
  }
  async function write(url: string, method: string, body?: object) {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "Save failed" })) as { error?: string };
      throw new Error(data.error || "Save failed");
    }
  }
  async function sendDraft(id: string, body: string) {
    if (!project) return;
    await post(`/api/projects/${project.id}/work-items`, { body });
    await write(`/api/projects/${project.id}/draft?id=${id}`, "DELETE");
    setEditing(undefined);
    await mutate();
  }

  return (
    <div className={styles.shell} data-app-shell>
      <ProjectSidebar
        projects={data}
        colors={projectColors}
        avatars={projectAvatars}
        selected={project?.id}
        onSelect={(id) => { setSelectedId(id); setEditing(undefined); }}
        onNew={() => setAddingProject(true)}
        onAppearance={(target) => setProjectAppearanceId(target.id)}
        health={health}
        onHealth={() => setShowHealth(true)}
        onPause={async (target) => {
          await write(`/api/projects/${target.id}`, "PATCH", { paused: !target.paused });
          await mutate();
        }}
        onDelete={async (target) => {
          await write(`/api/projects/${target.id}`, "DELETE", { confirmation: target.id });
          if (target.id === project?.id) setSelectedId(data.find((item) => item.id !== target.id)?.id || "");
          await mutate();
        }}
      />
      {project ? <ProjectView
        project={project}
        colors={colors}
        avatars={avatars}
        promptEditor={promptAgent && <AgentPromptEditor agent={promptAgent} onClose={() => setPromptId(undefined)} onSave={async (prompt) => {
          await write(`/api/projects/${project.id}/agents/${promptAgent.id}`, "PUT", { prompt });
          await mutate();
        }} />}
        editor={editing && <TaskEditor
          key={`${project.id}:${editing.kind}:${editing.item.id}`}
          initialMarkdown={editing.item.content || ""}
          status={editing.item.status}
          draft={editing.kind === "draft"}
          onBack={() => { setEditing(undefined); void mutate(); }}
          onSave={(body) => editing.kind === "draft"
            ? write(`/api/projects/${project.id}/draft`, "PUT", { id: editing.item.id, body })
            : write(`/api/projects/${project.id}/documents`, "PUT", { path: editing.item.meta, body })}
          onSend={editing.kind === "draft" ? (body) => sendDraft(editing.item.id, body) : undefined}
        />}
        onAgent={(agent) => setChat({ agentId: agent.id })}
        onPrefetch={(agent) => prefetchConversation(project.id, agent.id)}
        onAppearance={(agent) => setAppearanceId(agent.id)}
        onPrompt={(agent) => setPromptId(agent.id)}
        onDelete={async (agent) => {
          await write(`/api/projects/${project.id}/agents/${agent.id}`, "DELETE");
          await mutate();
        }}
        onClearContext={async (agent) => {
          await write(`/api/projects/${project.id}/agents/${agent.id}`, "PATCH");
          await mutate();
        }}
        onTask={(item) => item.status === "draft" ? setEditing({ kind: "draft", item }) : item.agentId && setChat({ agentId: item.agentId, focusId: item.chatId })}
        onTaskCancel={async (item) => {
          await write(`/api/projects/${project.id}/work-items`, "PATCH", { id: item.id });
          await mutate();
        }}
        onTaskDelete={async (item) => {
          await write(`/api/projects/${project.id}/work-items`, "DELETE", { id: item.id });
          await mutate();
        }}
        onTodo={(item) => item.agentId && setChat({ agentId: item.agentId, focusId: item.chatId })}
        onTodoDelete={async (item) => {
          await write(`/api/projects/${project.id}/todos`, "DELETE", { path: item.meta });
          await mutate();
        }}
        onAddWork={() => setEditing({ kind: "draft", item: newDraft() })}
      /> : <EmptyProject onCreate={() => setAddingProject(true)} />}
      {project && <ActivityRail project={project} cutoff={activityCutoffs[project.id]} onClear={() => setActivityCutoffs({ ...activityCutoffs, [project.id]: new Date().toISOString() })} onOpen={(agent, focusId) => setChat({ agentId: agent.id, focusId })} />}

      <ActionDrawer title={chatAgent ? `Conversation with ${chatAgent.id}` : ""} open={Boolean(chatAgent)} wide onClose={() => setChat(undefined)}>
        {chat && chatAgent && project && <ConversationDrawer key={`${project.id}:${chatAgent.id}:${chat.focusId || "latest"}`} projectId={project.id} agent={chatAgent} colors={colors} avatars={avatars} focusId={chat.focusId} onProjectMutate={mutate} />}
      </ActionDrawer>
      <ActionDrawer title="New project" open={addingProject} onClose={() => setAddingProject(false)}>
        <NewProjectForm onCreate={createProject} />
      </ActionDrawer>
      <ActionDrawer title={appearanceAgent ? `Appearance · ${appearanceAgent.id}` : ""} open={Boolean(appearanceAgent)} onClose={() => setAppearanceId(undefined)}>
        {appearanceAgent && <IdentityEditor name={appearanceAgent.id} color={agentColor(appearanceAgent.id, colors)} avatar={avatars[appearanceAgent.id]} onColor={(color) => setColors({ ...colors, [appearanceAgent.id]: color })} onAvatar={(avatar) => {
          const next = { ...avatars };
          if (avatar) next[appearanceAgent.id] = avatar;
          else delete next[appearanceAgent.id];
          setAvatars(next);
        }} />}
      </ActionDrawer>
      <ActionDrawer title={appearanceProject ? `Appearance · ${appearanceProject.name}` : ""} open={Boolean(appearanceProject)} onClose={() => setProjectAppearanceId(undefined)}>
        {appearanceProject && <IdentityEditor name={appearanceProject.name} color={agentColor(appearanceProject.id, projectColors)} avatar={projectAvatars[appearanceProject.id]} onColor={(color) => setProjectColors({ ...projectColors, [appearanceProject.id]: color })} onAvatar={(avatar) => {
          const next = { ...projectAvatars };
          if (avatar) next[appearanceProject.id] = avatar;
          else delete next[appearanceProject.id];
          setProjectAvatars(next);
        }} />}
      </ActionDrawer>
      <ActionDrawer title="System status" open={showHealth} onClose={() => setShowHealth(false)}>
        <SystemStatus health={health} onRestart={async (projectId) => {
          await post("/api/health", { projectId });
          await Promise.all([mutate(), mutateHealth()]);
        }} />
      </ActionDrawer>
    </div>
  );
}

function newDraft(): QueueItem {
  return { id: crypto.randomUUID(), title: "Untitled draft", meta: "", status: "draft", content: "" };
}
const healthy: HealthState = { status: "healthy", label: "Checking system status", issues: [] };
