import { Plus } from "lucide-react";
import type { Project } from "@/lib/types";
import { ProjectNavItem } from "../ProjectNavItem/ProjectNavItem";
import styles from "./ProjectSidebar.module.css";

interface Props { projects: Project[]; selected?: string; onSelect: (id: string) => void; onNew: () => void; }

export function ProjectSidebar({ projects, selected, onSelect, onNew }: Props) {
  return (
    <aside className={styles.sidebar} aria-label="Project navigation">
      <div className={styles.brand}><span>H</span><strong>Harness</strong></div>
      <div className={styles.label}><span>Projects</span><button aria-label="New project" onClick={onNew}><Plus size={13} /></button></div>
      <nav>
        {projects.map((project) => <ProjectNavItem key={project.id} name={project.name} count={project.agents.length} active={project.id === selected} onClick={() => onSelect(project.id)} />)}
      </nav>
      <div className={styles.footer}><span />Live local data</div>
    </aside>
  );
}
