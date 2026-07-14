"use client";

import type { Project } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import styles from "./ProjectColorSettings.module.css";

interface Props { projects: Project[]; colors: Record<string, string>; onChange: (colors: Record<string, string>) => void; }

export function ProjectColorSettings({ projects, colors, onChange }: Props) {
  return (
    <div className={styles.list}>
      <p>Project colors</p>
      {projects.map((project) => (
        <label key={project.id}>
          <span style={{ background: agentColor(project.id, colors) }} />
          <strong>{project.name}</strong>
          <input aria-label={`${project.name} project color`} type="color" value={agentColor(project.id, colors)} onChange={(event) => onChange({ ...colors, [project.id]: event.target.value })} />
        </label>
      ))}
    </div>
  );
}
