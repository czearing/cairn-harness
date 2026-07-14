import { Boxes, Layers3, UserPlus } from "lucide-react";
import type { Agent, Project, QueueItem } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { AgentCard } from "../AgentCard/AgentCard";
import { AutomationCard } from "../AutomationCard/AutomationCard";
import { DelegatedTodoRow } from "../DelegatedTodoRow/DelegatedTodoRow";
import { Panel } from "../Panel/Panel";
import { ProjectHeader } from "../ProjectHeader/ProjectHeader";
import { TaskList } from "../TaskList/TaskList";
import styles from "../Dashboard/Dashboard.module.css";

interface Props {
  project: Project; colors: Record<string, string>; avatars: Record<string, string>;
  editor?: React.ReactNode; promptEditor?: React.ReactNode;
  onAgent: (agent: Agent) => void; onPrefetch: (agent: Agent) => void;
  onAppearance: (agent: Agent) => void; onPrompt: (agent: Agent) => void;
  onMakeLeader: (agent: Agent) => void; onPauseToggle: (agent: Agent) => void; onClearContext: (agent: Agent) => void; onDelete: (agent: Agent) => void;
  onTask: (item: QueueItem) => void; onTaskCancel: (item: QueueItem) => Promise<void>;
  onTaskDelete: (item: QueueItem) => Promise<void>; onTodo: (item: QueueItem) => void;
  onTodoDelete: (item: QueueItem) => Promise<void>; onAddWork: () => void;
  onAddAgent: () => void;
  onConfigureAutomation: () => void;
}

export function ProjectView({ project, colors, avatars, editor, promptEditor, onAgent, onPrefetch, onAppearance, onPrompt, onMakeLeader, onPauseToggle, onClearContext, onDelete, onTask, onTaskCancel, onTaskDelete, onTodo, onTodoDelete, onAddWork, onAddAgent, onConfigureAutomation }: Props) {
  const active = project.agents.filter((agent) => agent.status === "working").length;
  return <main className={styles.main}>
    <ProjectHeader name={project.name} root={shortPath(project.root)} active={active} releases={project.releases} onAdd={onAddWork} />
    <AutomationCard project={project} onConfigure={onConfigureAutomation} />
    <section className={styles.section}><div className={styles.sectionTitle}><h2>Agents</h2><div><span>{project.agents.length} configured</span><button onClick={onAddAgent}><UserPlus size={13} />New agent</button></div></div>
      {project.agents.length ? <div className={styles.agents}>{project.agents.map((agent) => <AgentCard key={agent.id} agent={agent} color={agentColor(agent.id, colors)} avatar={avatars[agent.id]} onClick={() => onAgent(agent)} onPrefetch={() => onPrefetch(agent)} onAppearance={() => onAppearance(agent)} onPrompt={() => onPrompt(agent)} onMakeLeader={() => onMakeLeader(agent)} onPauseToggle={() => onPauseToggle(agent)} onClearContext={() => onClearContext(agent)} onDelete={() => onDelete(agent)} />)}</div> :
        <div className={styles.emptyAgents}><strong>Build your team</strong><span>Create your first agent to start working in this workspace.</span><button onClick={onAddAgent}><UserPlus size={14} />Create first agent</button></div>}
      {promptEditor}
    </section>
    <div className={styles.workGrid}>
      <Panel title="Tasks" action={<Boxes size={14} />}><TaskList drafts={project.drafts || []} tasks={project.workItems} editor={editor} onOpen={onTask} onCancel={onTaskCancel} onDelete={onTaskDelete} /></Panel>
      <Panel title="Delegated action plan" action={<Layers3 size={14} />}>{project.todos.length ? project.todos.map((item) => {
        const agent = project.agents.find((value) => value.id === item.agentId);
        return <DelegatedTodoRow key={item.id} item={item} agent={agent} color={agent ? agentColor(agent.id, colors) : undefined} avatar={item.agentId ? avatars[item.agentId] : undefined} onClick={() => onTodo(item)} onDelete={() => onTodoDelete(item)} />;
      }) : <div className={styles.blank}>No active delegations</div>}</Panel>
    </div>
  </main>;
}

function shortPath(value: string) {
  return value.split(/[\\/]/).filter(Boolean).slice(-3).join("\\");
}
