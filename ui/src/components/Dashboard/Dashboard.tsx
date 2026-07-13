"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Activity as ActivityIcon, Boxes, Layers3 } from "lucide-react";
import type { Agent, Project } from "@/lib/types";
import { ActionDrawer } from "../ActionDrawer/ActionDrawer";
import { ActivityRow } from "../ActivityRow/ActivityRow";
import { AgentCard } from "../AgentCard/AgentCard";
import { MessageComposer } from "../MessageComposer/MessageComposer";
import { Panel } from "../Panel/Panel";
import { ProjectHeader } from "../ProjectHeader/ProjectHeader";
import { ProjectNavItem } from "../ProjectNavItem/ProjectNavItem";
import { QueueRow } from "../QueueRow/QueueRow";
import { WorkItemForm } from "../WorkItemForm/WorkItemForm";
import styles from "./Dashboard.module.css";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

export function Dashboard({ initialProjects }: { initialProjects: Project[] }) {
  const { data = initialProjects, mutate } = useSWR<Project[]>("/api/projects", fetcher, {
    fallbackData: initialProjects,
    refreshInterval: 2000,
    revalidateOnFocus: true,
  });
  const [selectedId, setSelectedId] = useState(initialProjects[0]?.id);
  const [messageAgent, setMessageAgent] = useState<Agent>();
  const [addingWork, setAddingWork] = useState(false);
  const project = useMemo(() => data.find((item) => item.id === selectedId) || data[0], [data, selectedId]);

  if (!project) return <EmptyState />;
  const active = project.agents.filter((agent) => agent.status === "working").length;
  async function post(endpoint: string, body: object) {
    const response = await fetch(`/api/projects/${project.id}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
      throw new Error(data.error || "Request failed");
    }
    await mutate();
  }

  return (
    <div className={styles.shell} data-app-shell>
      <aside className={styles.sidebar} aria-label="Project navigation">
        <div className={styles.brand}><span>H</span><strong>Harness</strong></div>
        <p className={styles.label}>Projects</p>
        <nav>
          {data.map((item) => <ProjectNavItem key={item.id} name={item.name} count={item.agents.length} active={item.id === project.id} onClick={() => setSelectedId(item.id)} />)}
        </nav>
        <div className={styles.sidebarFoot}><span className={styles.liveDot} />Live local data</div>
      </aside>

      <main className={styles.main}>
        <ProjectHeader name={project.name} root={project.root} active={active} releases={project.releases} onAdd={() => setAddingWork(true)} />
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2>Agents</h2><span>{project.agents.length} configured</span></div>
          <div className={styles.agents}>{project.agents.map((agent) => <AgentCard key={agent.id} agent={agent} onMessage={() => setMessageAgent(agent)} />)}</div>
        </section>
        <div className={styles.workGrid}>
          <Panel title="Work items" action={<Boxes size={14} />}>
            {project.workItems.length ? project.workItems.map((item) => <QueueRow key={item.id} item={item} />) : <Blank text="No active work items" />}
          </Panel>
          <Panel title="Delegated TODOs" action={<Layers3 size={14} />}>
            {project.todos.length ? project.todos.map((item) => <QueueRow key={item.id} item={item} />) : <Blank text="No delegated TODOs" />}
          </Panel>
        </div>
      </main>

      <aside className={styles.activity} aria-label="Recent activity">
        <div className={styles.activityTitle}><ActivityIcon size={14} /><span>Recent activity</span></div>
        {project.activity.length ? project.activity.map((item) => <ActivityRow key={item.id} activity={item} />) : <Blank text="No completed turns" />}
      </aside>

      <ActionDrawer title={messageAgent ? `Message ${messageAgent.id}` : ""} open={Boolean(messageAgent)} onClose={() => setMessageAgent(undefined)}>
        {messageAgent && <MessageComposer agent={messageAgent.id} onSend={async (body) => { await post("messages", { agent: messageAgent.id, body }); setMessageAgent(undefined); }} />}
      </ActionDrawer>
      <ActionDrawer title="New work item" open={addingWork} onClose={() => setAddingWork(false)}>
        <WorkItemForm onCreate={async (body) => { await post("work-items", { body }); setAddingWork(false); }} />
      </ActionDrawer>
    </div>
  );
}

function Blank({ text }: { text: string }) {
  return <div className={styles.blank}>{text}</div>;
}
function EmptyState() {
  return <main className={styles.empty}><h1>No projects found</h1><p>Add project configs with HARNESS_PROJECTS.</p></main>;
}
