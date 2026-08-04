import { Button } from "@/components/Button/Button";
import { IconButton } from "@/components/IconButton/IconButton";
import { IdentityMark } from "@/components/IdentityMark/IdentityMark";
import { MoreHorizontal } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import styles from "./ProjectNavItem.module.css";

interface Props {
  projectId: string;
  name: string;
  avatar?: string;
  count: number;
  color?: string;
  active?: boolean;
  paused?: boolean;
  inProgress?: boolean;
  menuOpen: boolean;
  onClick: (projectId: string) => void;
  onMenu: (projectId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (projectId: string, event: MouseEvent<HTMLButtonElement>) => void;
}

export function ProjectNavItem({ projectId, name, avatar, count, color, active, paused, inProgress, menuOpen, onClick, onMenu, onContextMenu }: Props) {
  const identity = { "--project-color": color } as CSSProperties;
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
        className={`${styles.item} ${active ? styles.active : ""} ${paused ? styles.paused : ""} ${inProgress ? styles.progress : ""}`}
        onClick={select}
        onContextMenu={openContextMenu}
      >
        <IdentityMark name={name} avatarUrl={avatar} color={color} size="sm" className={styles.mark} />
        <span className={styles.name}>{name}</span>
        <span className={styles.count} aria-label={`${count} tasks`}>{count}</span>
        <StatusIndicator status={paused ? "paused" : inProgress ? "working" : "healthy"} label={paused ? "Project paused" : inProgress ? "Project working" : "Project ready"} display="dot" />
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

