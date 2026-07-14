"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { Activity as ActivityIcon, Boxes, Layers3 } from "lucide-react";
import type { Agent, Project, QueueItem } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { useAgentColors } from "@/lib/use-agent-colors";
import { useStoredRecord } from "@/lib/use-stored-record";
import { useSelectedProject } from "@/lib/use-selected-project";
import { ActionDrawer } from "../ActionDrawer/ActionDrawer";
import { AgentIdentityEditor } from "../AgentIdentityEditor/AgentIdentityEditor";
import { AgentPromptEditor } from "../AgentPromptEditor/AgentPromptEditor";
import { ActivityRow } from "../ActivityRow/ActivityRow";
import { AgentCard } from "../AgentCard/AgentCard";
import { ConversationDrawer } from "../ConversationDrawer/ConversationDrawer";
import { NewProjectForm } from "../NewProjectForm/NewProjectForm";
import { Panel } from "../Panel/Panel";
import { ProjectHeader } from "../ProjectHeader/ProjectHeader";
import { ProjectColorSettings } from "../ProjectColorSettings/ProjectColorSettings";
import { ProjectSidebar } from "../ProjectSidebar/ProjectSidebar";
import { QueueRow } from "../QueueRow/QueueRow";
import styles from "./Dashboard.module.css";

const fetcher = (url: string) => fetch(url).then((response) => response.json());
const TaskEditor = dynamic(() => import("../TaskEditor/TaskEditor").then((module) => module.TaskEditor), {
  ssr: false,
  loading: () => <div className={styles.editorLoading}>Opening editor</div>,
});
interface ChatSelection { agentId: string; focusId?: string; }
interface EditorSelection { kind: "draft" | "document"; item: QueueItem; }

export function Dashboard({ initialProjects }: { initialProjects: Project[] }) {
  const { data = initialProjects, mutate } = useSWR<Project[]>("/api/projects", fetcher, { fallbackData: initialProjects });
  const [selectedId, setSelectedId] = useSelectedProject(initialProjects[0]?.id);
  const [chat, setChat] = useState<ChatSelection>();
  const [editing, setEditing] = useState<EditorSelection>();
  const [addingProject, setAddingProject] = useState(false);
  const [settings, setSettings] = useState(false);
  const [appearanceId, setAppearanceId] = useState<string>();
  const [promptId, setPromptId] = useState<string>();
  const [colors, setColors] = useAgentColors();
  const [avatars, setAvatars] = useStoredRecord("harness-agent-avatars");
  const [projectColors, setProjectColors] = useStoredRecord("harness-project-colors");
  const project = data.find((item) => item.id === selectedId) || data[0];
  const chatAgent = project?.agents.find((agent) => agent.id === chat?.agentId);
  const appearanceAgent = project?.agents.find((agent) => agent.id === appearanceId);
  const promptAgent = project?.agents.find((agent) => agent.id === promptId);

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
      <ProjectSidebar projects={data} colors={projectColors} selected={project?.id} onSelect={(id) => { setSelectedId(id); setEditing(undefined); }} onNew={() => setAddingProject(true)} onSettings={() => setSettings(true)} />
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
        onAppearance={(agent) => setAppearanceId(agent.id)}
        onPrompt={(agent) => setPromptId(agent.id)}
        onTask={(item) => item.status === "draft" ? setEditing({ kind: "draft", item }) : item.agentId && setChat({ agentId: item.agentId, focusId: item.chatId })}
        onTodo={(item) => item.agentId && setChat({ agentId: item.agentId, focusId: item.chatId })}
        onAddWork={() => setEditing({ kind: "draft", item: newDraft() })}
      /> : <EmptyState onCreate={() => setAddingProject(true)} />}
      {project && <ActivityRail project={project} onOpen={(agent, focusId) => setChat({ agentId: agent.id, focusId })} />}

      <ActionDrawer title={chatAgent ? `Conversation with ${chatAgent.id}` : ""} open={Boolean(chatAgent)} wide onClose={() => setChat(undefined)}>
        {chat && chatAgent && project && <ConversationDrawer key={`${project.id}:${chatAgent.id}:${chat.focusId || "latest"}`} projectId={project.id} agent={chatAgent} colors={colors} avatars={avatars} focusId={chat.focusId} onProjectMutate={mutate} />}
      </ActionDrawer>
      <ActionDrawer title="New project" open={addingProject} onClose={() => setAddingProject(false)}>
        <NewProjectForm onCreate={createProject} />
      </ActionDrawer>
      <ActionDrawer title="Settings" open={settings} onClose={() => setSettings(false)}>
        <ProjectColorSettings projects={data} colors={projectColors} onChange={setProjectColors} />
      </ActionDrawer>
      <ActionDrawer title={appearanceAgent ? `Appearance · ${appearanceAgent.id}` : ""} open={Boolean(appearanceAgent)} onClose={() => setAppearanceId(undefined)}>
        {appearanceAgent && <AgentIdentityEditor agent={appearanceAgent} color={agentColor(appearanceAgent.id, colors)} avatar={avatars[appearanceAgent.id]} onColor={(color) => setColors({ ...colors, [appearanceAgent.id]: color })} onAvatar={(avatar) => {
          const next = { ...avatars };
          if (avatar) next[appearanceAgent.id] = avatar;
          else delete next[appearanceAgent.id];
          setAvatars(next);
        }} />}
      </ActionDrawer>
    </div>
  );
}

function ProjectView({ project, colors, avatars, editor, promptEditor, onAgent, onAppearance, onPrompt, onTask, onTodo, onAddWork }: {
  project: Project; colors: Record<string, string>; avatars: Record<string, string>; editor?: React.ReactNode; promptEditor?: React.ReactNode; onAgent: (agent: Agent) => void; onAppearance: (agent: Agent) => void; onPrompt: (agent: Agent) => void; onTask: (item: QueueItem) => void; onTodo: (item: QueueItem) => void; onAddWork: () => void;
}) {
  const active = project.agents.filter((agent) => agent.status === "working").length;
  return <main className={styles.main}>
    <ProjectHeader name={project.name} root={shortPath(project.root)} active={active} releases={project.releases} onAdd={onAddWork} />
    <section className={styles.section}><div className={styles.sectionTitle}><h2>Agents</h2><span>{project.agents.length} configured</span></div>
      <div className={styles.agents}>{project.agents.map((agent) => <AgentCard key={agent.id} agent={agent} color={agentColor(agent.id, colors)} avatar={avatars[agent.id]} onClick={() => onAgent(agent)} onAppearance={() => onAppearance(agent)} onPrompt={() => onPrompt(agent)} />)}</div>
      {promptEditor}
    </section>
    <div className={styles.workGrid}>
      <Panel title="Tasks" action={<Boxes size={14} />}>{project.drafts?.map((item) => <QueueRow key={item.id} item={item} onClick={() => onTask(item)} />)}{project.workItems.length ? project.workItems.map((item) => <QueueRow key={item.id} item={item} onClick={() => onTask(item)} />) : !project.drafts?.length && !editor && <Blank text="No active tasks" />}{editor}</Panel>
      <Panel title="Delegated TODOs" action={<Layers3 size={14} />}>{project.todos.length ? project.todos.map((item) => <QueueRow key={item.id} item={item} onClick={() => onTodo(item)} />) : <Blank text="No delegated TODOs" />}</Panel>
    </div>
  </main>;
}

function ActivityRail({ project, onOpen }: { project: Project; onOpen: (agent: Agent, focusId: string) => void }) {
  return <aside className={styles.activity} aria-label="Recent activity">
    <div className={styles.activityTitle}><ActivityIcon size={14} /><span>Recent activity</span></div>
    {project.activity.length ? project.activity.map((item) => <ActivityRow key={item.id} activity={item} onClick={() => { const agent = project.agents.find((value) => value.id === item.agent); if (agent) onOpen(agent, item.chatId); }} />) : <Blank text="No completed turns" />}
  </aside>;
}

function Blank({ text }: { text: string }) { return <div className={styles.blank}>{text}</div>; }
function newDraft(): QueueItem {
  return { id: crypto.randomUUID(), title: "Untitled draft", meta: "", status: "draft", content: "" };
}
function shortPath(value: string) { return value.split(/[\\/]/).filter(Boolean).slice(-3).join("\\"); }
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <main className={styles.empty}><h1>No projects yet</h1><p>Create a project and add your agents.</p><button onClick={onCreate}>Create project</button></main>;
}
