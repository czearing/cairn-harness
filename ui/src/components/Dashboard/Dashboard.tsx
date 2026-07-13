"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Activity as ActivityIcon, Boxes, Layers3 } from "lucide-react";
import type { Agent, Project, QueueItem } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { useAgentColors } from "@/lib/use-agent-colors";
import { ActionDrawer } from "../ActionDrawer/ActionDrawer";
import { AgentColorSettings } from "../AgentColorSettings/AgentColorSettings";
import { ActivityRow } from "../ActivityRow/ActivityRow";
import { AgentCard } from "../AgentCard/AgentCard";
import { ChatPanel } from "../ChatPanel/ChatPanel";
import { DocumentPanel } from "../DocumentPanel/DocumentPanel";
import { NewProjectForm } from "../NewProjectForm/NewProjectForm";
import { Panel } from "../Panel/Panel";
import { ProjectHeader } from "../ProjectHeader/ProjectHeader";
import { ProjectSidebar } from "../ProjectSidebar/ProjectSidebar";
import { QueueRow } from "../QueueRow/QueueRow";
import { WorkItemForm } from "../WorkItemForm/WorkItemForm";
import styles from "./Dashboard.module.css";

const fetcher = (url: string) => fetch(url).then((response) => response.json());
interface ChatSelection { agent: Agent; focusId?: string; }

export function Dashboard({ initialProjects }: { initialProjects: Project[] }) {
  const { data = initialProjects, mutate } = useSWR<Project[]>("/api/projects", fetcher, { fallbackData: initialProjects, refreshInterval: 2000 });
  const [selectedId, setSelectedId] = useState(initialProjects[0]?.id);
  const [chat, setChat] = useState<ChatSelection>();
  const [document, setDocument] = useState<QueueItem>();
  const [addingWork, setAddingWork] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [settings, setSettings] = useState(false);
  const [colors, setColors] = useAgentColors();
  const project = useMemo(() => data.find((item) => item.id === selectedId) || data[0], [data, selectedId]);

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

  return (
    <div className={styles.shell} data-app-shell>
      <ProjectSidebar projects={data} selected={project?.id} onSelect={setSelectedId} onNew={() => setAddingProject(true)} onSettings={() => setSettings(true)} />
      {project ? <ProjectView project={project} colors={colors} onAgent={(agent) => setChat({ agent })} onDocument={setDocument} onAddWork={() => setAddingWork(true)} /> : <EmptyState onCreate={() => setAddingProject(true)} />}
      {project && <ActivityRail project={project} onOpen={(agent, focusId) => setChat({ agent, focusId })} />}

      <ActionDrawer title={chat ? `Conversation with ${chat.agent.id}` : ""} open={Boolean(chat)} onClose={() => setChat(undefined)}>
        {chat && project && <ChatPanel agent={chat.agent} messages={project.conversations[chat.agent.id] || []} colors={colors} focusId={chat.focusId} onSend={(body) => post(`/api/projects/${project.id}/messages`, { agent: chat.agent.id, body }).then(() => undefined)} />}
      </ActionDrawer>
      <ActionDrawer title={document?.title || ""} open={Boolean(document)} onClose={() => setDocument(undefined)}>
        {document && <DocumentPanel item={document} />}
      </ActionDrawer>
      <ActionDrawer title="New work item" open={addingWork} onClose={() => setAddingWork(false)}>
        {project && <WorkItemForm onCreate={async (body) => { await post(`/api/projects/${project.id}/work-items`, { body }); setAddingWork(false); }} />}
      </ActionDrawer>
      <ActionDrawer title="New project" open={addingProject} onClose={() => setAddingProject(false)}>
        <NewProjectForm onCreate={createProject} />
      </ActionDrawer>
      <ActionDrawer title="Settings" open={settings} onClose={() => setSettings(false)}>
        {project && <AgentColorSettings agents={project.agents} colors={colors} onChange={setColors} />}
      </ActionDrawer>
    </div>
  );
}

function ProjectView({ project, colors, onAgent, onDocument, onAddWork }: {
  project: Project; colors: Record<string, string>; onAgent: (agent: Agent) => void; onDocument: (item: QueueItem) => void; onAddWork: () => void;
}) {
  const active = project.agents.filter((agent) => agent.status === "working").length;
  return <main className={styles.main}>
    <ProjectHeader name={project.name} root={shortPath(project.root)} active={active} releases={project.releases} onAdd={onAddWork} />
    <section className={styles.section}><div className={styles.sectionTitle}><h2>Agents</h2><span>{project.agents.length} configured</span></div>
      <div className={styles.agents}>{project.agents.map((agent) => <AgentCard key={agent.id} agent={agent} color={agentColor(agent.id, colors)} onClick={() => onAgent(agent)} />)}</div>
    </section>
    <div className={styles.workGrid}>
      <Panel title="Work items" action={<Boxes size={14} />}>{project.workItems.length ? project.workItems.map((item) => <QueueRow key={item.id} item={item} onClick={() => onDocument(item)} />) : <Blank text="No active work items" />}</Panel>
      <Panel title="Delegated TODOs" action={<Layers3 size={14} />}>{project.todos.length ? project.todos.map((item) => <QueueRow key={item.id} item={item} onClick={() => onDocument(item)} />) : <Blank text="No delegated TODOs" />}</Panel>
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
function shortPath(value: string) { return value.split(/[\\/]/).filter(Boolean).slice(-3).join("\\"); }
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <main className={styles.empty}><h1>No projects yet</h1><p>Create a project and add your agents.</p><button onClick={onCreate}>Create project</button></main>;
}
