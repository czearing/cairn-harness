import { useState } from "react";
import { Plus } from "lucide-react";
import type { HealthState, Project } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { ProjectNavItem } from "../ProjectNavItem/ProjectNavItem";
import { ProjectContextMenu } from "../ProjectContextMenu/ProjectContextMenu";
import styles from "./ProjectSidebar.module.css";

interface Props {
  projects: Project[]; colors?: Record<string, string>; avatars?: Record<string, string>; selected?: string;
  onSelect: (id: string) => void; onNew: () => void; onAppearance: (project: Project) => void;
  health: HealthState; onHealth: () => void; onPause: (project: Project) => Promise<void>; onDelete: (project: Project) => Promise<void>;
}

export function ProjectSidebar({ projects, colors = {}, avatars = {}, selected, onSelect, onNew, onAppearance, health, onHealth, onPause, onDelete }: Props) {
  const [menu, setMenu] = useState<{ project: Project; x: number; y: number }>();
  return (
    <aside className={styles.sidebar} aria-label="Project navigation">
      <div className={styles.brand}><span>H</span><strong>Harness</strong></div>
      <div className={styles.label}><span>Projects</span><button aria-label="New project" onClick={onNew}><Plus size={13} /></button></div>
      <nav>
        {projects.map((project) => <ProjectNavItem key={project.id} name={project.name} avatar={avatars[project.id]} count={project.paused ? 0 : project.activeWorkCount ?? project.workItems.filter((item) => !["done", "completed", "released", "cancelled"].includes(item.status)).length} color={agentColor(project.id, colors)} paused={project.paused} inProgress={Boolean(project.activeWorkCount) && !project.paused} active={project.id === selected} onClick={() => onSelect(project.id)} onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ project, x: event.clientX, y: event.clientY });
        }} />)}
      </nav>
      <button className={styles.health} onClick={onHealth}><span className={styles[health.status]} />{health.label}</button>
      {menu && <ProjectContextMenu
        project={menu.project}
        x={menu.x}
        y={menu.y}
        color={agentColor(menu.project.id, colors)}
        avatar={avatars[menu.project.id]}
        onAppearance={() => { onAppearance(menu.project); setMenu(undefined); }}
        onPause={async () => { await onPause(menu.project); setMenu(undefined); }}
        onDelete={async () => { await onDelete(menu.project); setMenu(undefined); }}
        onClose={() => setMenu(undefined)}
      />}
    </aside>
  );
}
