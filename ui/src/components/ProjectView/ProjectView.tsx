import { Button } from "@/components/Button/Button";
import { UserPlus } from "lucide-react";
import type { Agent, Project, QueueItem } from "@/lib/types";
import { agentAppearanceOverride, projectAgentColor } from "@/lib/agent-appearance";
import { AgentCard } from "../AgentCard/AgentCard";
import type { AgentDeletionPreview } from "../AgentWorkspace/agent-workspace-types";
import { AgentSectionActions } from "../AgentSectionActions/AgentSectionActions";
import { ProjectHeader } from "../ProjectHeader/ProjectHeader";
import { ActiveWork } from "../ActiveWork/ActiveWork";
import { AnalyticsPanel } from "../AnalyticsPanel/AnalyticsPanel";
import styles from "../Dashboard/Dashboard.module.css";

interface Props {
  project: Project; colors: Record<string, string>; avatars: Record<string, string>;
  workspaceView: "overview" | "activity";
  onWorkspaceView: (view: "overview" | "activity") => void;
  onAgent: (agent: Agent, returnFocus?: HTMLElement) => void;
  onConfigureAgent: (agent: Agent, returnFocus?: HTMLElement) => void;
  onPrefetch: (agent: Agent) => void;
  onAgentPauseToggle: (agent: Agent) => Promise<void>;
  onAgentClearContext: (agent: Agent) => Promise<void>;
  onAgentDelete: (agent: Agent) => Promise<void>;
  onAgentDeletionPreview: (agent: Agent) => Promise<AgentDeletionPreview>;
  onTask: (item: QueueItem) => void; onTaskCancel: (item: QueueItem) => Promise<void>;
  onTaskDelete: (item: QueueItem) => Promise<void>; onDelegation: (item: QueueItem) => void;
  onDelegationCancel: (item: QueueItem) => Promise<void>; onAddWork: (keyboardFocus?: boolean) => void;
  onAddAgent: () => void;
  onConfigureProject: () => void; onConfigureIdeas: () => void;
}

export function ProjectView({ project, colors, avatars, workspaceView, onWorkspaceView, onAgent, onConfigureAgent, onPrefetch, onAgentPauseToggle, onAgentClearContext, onAgentDelete, onAgentDeletionPreview, onTask, onTaskCancel, onTaskDelete, onDelegation, onDelegationCancel, onAddWork, onAddAgent, onConfigureProject, onConfigureIdeas }: Props) {
  const leader = project.agents.find((agent) => agent.isLeader);
  const agents = project.agents
    .filter((agent) => agent.kind !== "local")
    .sort((a, b) => Number(Boolean(b.isLeader)) - Number(Boolean(a.isLeader))
      || Number(Boolean(b.isIdeaAgent)) - Number(Boolean(a.isIdeaAgent))
      || (a.title || a.id).localeCompare(b.title || b.id));
  const card = (agent: Agent) => {
    return <AgentCard key={agent.id} projectId={project.id} agent={agent} color={projectAgentColor(colors, project.id, agent.id)} avatar={agentAppearanceOverride(avatars, project.id, agent.id)} onClick={(returnFocus) => onAgent(agent, returnFocus)} onConfigure={(returnFocus) => onConfigureAgent(agent, returnFocus)} onPrefetch={() => onPrefetch(agent)} onPauseToggle={() => onAgentPauseToggle(agent)} onClearContext={() => onAgentClearContext(agent)} onDelete={() => onAgentDelete(agent)} onDeletionPreview={() => onAgentDeletionPreview(agent)} />;
  };
  return <main className={styles.main} data-workspace-view={workspaceView}>
    <ProjectHeader name={project.name} root={project.root} onAdd={onAddWork} />
    <nav className={styles.workspaceNav} aria-label="Project workspace">
      <Button variant="inherit" aria-current={workspaceView === "overview" ? "page" : undefined} onClick={() => {
        onWorkspaceView("overview");
        document.getElementById("project-overview")?.scrollIntoView({ block: "start" });
      }}>Overview</Button>
      <Button variant="inherit" aria-current={workspaceView === "activity" ? "page" : undefined} onClick={() => onWorkspaceView("activity")}>Recent activity</Button>
    </nav>
    <div className={styles.workspaceLayout}>
      <div id="project-overview" className={styles.workspaceOverview}>
      <section className={styles.section} aria-labelledby="agents-heading"><div className={styles.sectionTitle}><h2 id="agents-heading">Agents</h2>
        <AgentSectionActions onAddAgent={onAddAgent} onConfigureProject={onConfigureProject} onConfigureIdeas={onConfigureIdeas} />
      </div>
        {!leader && agents.length > 0 && <p className={styles.agentWarning}>No project leader. Open an agent to assign one.</p>}
        {agents.length > 0 && <div className={styles.agentGrid}>{agents.map(card)}</div>}
        {!leader && agents.length === 0
          ? <div className={styles.emptyAgents}><strong>No agents yet</strong><Button variant="primary" onClick={onAddAgent}><UserPlus size={14} />Create leader</Button></div>
          : null}
      </section>
      <AnalyticsPanel projectId={project.id} colors={colors} />
      <div className={styles.workMap}>
        <ActiveWork
          projectId={project.id}
          agents={project.agents}
          colors={colors}
          avatars={avatars}
          roots={project.workItems}
          delegated={project.delegatedActions}
          onRoot={onTask}
          onRootCancel={onTaskCancel}
          onRootDelete={onTaskDelete}
          onChild={onDelegation}
          onChildCancel={onDelegationCancel}
          onChildDelete={onTaskDelete}
        />
      </div>
      </div>
    </div>
  </main>;
}
