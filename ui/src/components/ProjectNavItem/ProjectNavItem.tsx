import { Button } from "@/components/Button/Button";
import { IconButton } from "@/components/IconButton/IconButton";
import { IdentityMark } from "@/components/IdentityMark/IdentityMark";
import { MoreHorizontal } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import type { ProjectActivity } from "@/lib/project-activity";
import styles from "./ProjectNavItem.module.css";

interface Props {
  projectId: string;
  name: string;
  avatar?: string;
  count: number;
  color?: string;
  active?: boolean;
  paused?: boolean;
  status: ProjectActivity["status"];
  statusLabel: string;
  menuOpen: boolean;
  onClick: (projectId: string) => void;
  onMenu: (projectId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (projectId: string, event: MouseEvent<HTMLButtonElement>) => void;
}

export function ProjectNavItem({ projectId, name, avatar, count, color, active, paused, status, statusLabel, menuOpen, onClick, onMenu, onContextMenu }: Props) {
  const identity = { "--project-color": color } as CSSProperties;
  // The row shimmer means the project has work in flight at all; the dot carries the precise state.
  // Keying the shimmer to "working" alone would stop a queued project from reading as live.
  const live = status === "working" || status === "queued";
  const select = () => onClick(projectId);
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => onMenu(projectId, event);
  const openContextMenu = (event: MouseEvent<HTMLButtonElement>) => onContextMenu(projectId, event);
  return (
    <div className={styles.row} style={identity}>
      <Button
        variant="inherit"
        type="button"
        data-project-selection={projectId}
        aria-current={active ? "page" : undefined}
        className={`${styles.item} ${active ? styles.active : ""} ${paused ? styles.paused : ""} ${live ? styles.progress : ""}`}
        onClick={select}
        onContextMenu={openContextMenu}
      >
        <IdentityMark name={name} avatarUrl={avatar} color={color} size="sm" className={styles.mark} />
        <span className={styles.name}>{name}</span>
        <span className={styles.count} aria-label={`${count} active ${count === 1 ? "item" : "items"}`}>{count}</span>
        <StatusIndicator status={status} label={statusLabel} display="dot" />
      </Button>
      <IconButton
        size="compact"
        data-project-menu-trigger={projectId}
        className={styles.menuTrigger}
        label={`More options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={openMenu}
      >
        <MoreHorizontal aria-hidden="true" size={14} />
      </IconButton>
    </div>
  );
}

