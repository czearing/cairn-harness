import { Button } from "@/components/Button/Button";
import { IconButton } from "@/components/IconButton/IconButton";
import { IdentityMark } from "@/components/IdentityMark/IdentityMark";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Plus, Settings } from "lucide-react";
import type { HealthState, Project } from "@/lib/types";
import { agentColor } from "@/lib/colors";
import { ProjectNavItem } from "../ProjectNavItem/ProjectNavItem";
import { ProjectContextMenu } from "../ProjectContextMenu/ProjectContextMenu";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import { DashboardPane, DashboardPaneBody, DashboardPaneFooter, DashboardPaneHeader, DashboardPaneSectionLabel } from "../DashboardPane/DashboardPane";
import styles from "./ProjectSidebar.module.css";

const CLOSED_WORK_STATUSES = new Set(["done", "completed", "released", "cancelled"]);

function activeWorkCount(project: Project): number {
  return project.activeWorkCount ?? project.workItems.filter((item) => !CLOSED_WORK_STATUSES.has(item.status)).length;
}

interface Props {
  projects: Project[]; colors?: Record<string, string>; avatars?: Record<string, string>; selected?: string;
  onSelect: (id: string) => void; onNew: () => void; onAppearance: (project: Project) => void; onWorkflow: (project: Project) => void;
  health: HealthState; onHealth: () => void; onSettings: () => void; onPause: (project: Project) => Promise<void>; onDelete: (project: Project, confirmation: string) => Promise<void>;
}

interface MenuState {
  project: Project;
  x: number;
  y: number;
  source: "trigger" | "context";
  opener?: HTMLButtonElement;
  anchor?: { left: number; right: number; top: number; bottom: number };
}

export function ProjectSidebar({ projects, colors = {}, avatars = {}, selected, onSelect, onNew, onAppearance, onWorkflow, health, onHealth, onSettings, onPause, onDelete }: Props) {
  const [menu, setMenu] = useState<MenuState>();
  const nav = useRef<HTMLElement>(null);
  const newProject = useRef<HTMLButtonElement>(null);
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  const currentMenuProject = menu && projects.find((project) => project.id === menu.project.id);
  const visibleMenu = currentMenuProject ? menu : undefined;
  const rows = projects.map((project) => ({
    project,
    count: activeWorkCount(project),
    color: agentColor(project.id, colors),
  }));
  function restoreOpener(opener?: HTMLButtonElement) {
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
    });
  }
  function focusSurvivingProject(deletedId: string) {
    requestAnimationFrame(() => {
      const triggers = nav.current?.querySelectorAll<HTMLButtonElement>("[data-project-menu-trigger]");
      const trigger = triggers ? [...triggers].find((candidate) => candidate.dataset.projectMenuTrigger !== deletedId) : undefined;
      const selections = nav.current?.querySelectorAll<HTMLButtonElement>("[data-project-selection]");
      const row = selections ? [...selections].find((candidate) => candidate.dataset.projectSelection !== deletedId) : undefined;
      (trigger || row || newProject.current)?.focus();
    });
  }
  function handleSelect(projectId: string) {
    onSelect(projectId);
  }
  function handleMenu(projectId: string, event: MouseEvent<HTMLButtonElement>) {
    const trigger = event.currentTarget;
    setMenu((current) => {
      if (current?.source === "trigger" && current.project.id === projectId) {
        restoreOpener(trigger);
        return undefined;
      }
      const project = projectsRef.current.find((candidate) => candidate.id === projectId);
      if (!project) return current;
      const rect = trigger.getBoundingClientRect();
      return {
        project,
        x: rect.right,
        y: rect.bottom + 4,
        source: "trigger",
        opener: trigger,
        anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      };
    });
  }
  function handleContextMenu(projectId: string, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const project = projectsRef.current.find((candidate) => candidate.id === projectId);
    if (!project) return;
    setMenu({ project, x: event.clientX, y: event.clientY, source: "context", opener: event.currentTarget });
  }
  useEffect(() => {
    if (!menu || currentMenuProject) return;
    const removedId = menu.project.id;
    const frame = requestAnimationFrame(() => {
      setMenu((current) => current?.project.id === removedId ? undefined : current);
      focusSurvivingProject(removedId);
    });
    return () => cancelAnimationFrame(frame);
  }, [currentMenuProject, menu]);
  return (
    <DashboardPane id="project-navigation-rail" className={styles.sidebar} aria-label="Project navigation" tone="navigation">
      <DashboardPaneHeader className={styles.brand}>
        <IdentityMark name="Harness" />
        <div><strong>Harness</strong><small>Agent operations</small></div>
      </DashboardPaneHeader>
      <DashboardPaneBody className={styles.projects}>
        <DashboardPaneSectionLabel
          text="Projects"
          action={<IconButton size="compact" ref={newProject} label="New project" onClick={onNew}><Plus size={14} /></IconButton>}
        />
        <nav ref={nav}>
          {rows.map(({ project, count, color }) => <ProjectNavItem
            key={project.id}
            projectId={project.id}
            name={project.name}
            avatar={avatars[project.id]}
            count={count}
            color={color}
            paused={project.paused}
            inProgress={Boolean(project.activeWorkCount) && !project.paused}
            active={project.id === selected}
            menuOpen={visibleMenu?.source === "trigger" && visibleMenu.project.id === project.id}
            onClick={handleSelect}
            onMenu={handleMenu}
            onContextMenu={handleContextMenu}
          />)}
        </nav>
      </DashboardPaneBody>
      <DashboardPaneFooter className={styles.footer}>
        <Button variant="ghost" size="compact" className={styles.health} aria-label={health.label} onClick={onHealth}>
          <StatusIndicator status={health.status} label={health.label} size="compact" />
        </Button>
        <IconButton label="Global settings" onClick={onSettings}><Settings size={15} /></IconButton>
      </DashboardPaneFooter>
      {visibleMenu && currentMenuProject && <ProjectContextMenu
        project={currentMenuProject}
        x={menu.x}
        y={menu.y}
        anchor={menu.anchor}
        opener={menu.opener}
        color={agentColor(currentMenuProject.id, colors)}
        avatar={avatars[currentMenuProject.id]}
        onAppearance={() => {
          const opener = menu.opener;
          setMenu(undefined);
          opener?.focus();
          onAppearance(currentMenuProject);
        }}
        onWorkflow={() => {
          const opener = menu.opener;
          setMenu(undefined);
          opener?.focus();
          onWorkflow(currentMenuProject);
        }}
        onPause={async () => {
          await onPause(currentMenuProject);
          const opener = menu.opener;
          setMenu(undefined);
          restoreOpener(opener);
        }}
        onDelete={async () => {
          const deletedId = currentMenuProject.id;
          await onDelete(currentMenuProject, currentMenuProject.id);
          setMenu(undefined);
          focusSurvivingProject(deletedId);
        }}
        onClose={(reason) => {
          const opener = menu.opener;
          setMenu(undefined);
          if (reason === "escape") restoreOpener(opener);
        }}
      />}
    </DashboardPane>
  );
}
