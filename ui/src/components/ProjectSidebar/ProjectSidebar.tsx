import { Plus, Settings } from "lucide-react";
import type { Project } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { ProjectNavItem } from "../ProjectNavItem/ProjectNavItem";
import styles from "./ProjectSidebar.module.css";

interface Props { projects: Project[]; colors?: Record<string, string>; selected?: string; onSelect: (id: string) => void; onNew: () => void; onSettings: () => void; }

export function ProjectSidebar({ projects, colors = {}, selected, onSelect, onNew, onSettings }: Props) {
  return (
    <aside className={styles.sidebar} aria-label="Project navigation">
      <div className={styles.brand}><span>H</span><strong>Harness</strong></div>
      <div className={styles.label}><span>Projects</span><button aria-label="New project" onClick={onNew}><Plus size={13} /></button></div>
      <nav>
        {projects.map((project) => <ProjectNavItem key={project.id} name={project.name} count={project.workItemCount ?? project.workItems.length} color={agentColor(project.id, colors)} inProgress={Boolean(project.activeWorkCount)} active={project.id === selected} onClick={() => onSelect(project.id)} />)}
      </nav>
      <div className={styles.footer}><span />Live local data<button aria-label="Settings" onClick={onSettings}><Settings size={13} /></button></div>
    </aside>
  );
}
