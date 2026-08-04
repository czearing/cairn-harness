import { Button } from "@/components/Button/Button";
import type { Agent, QueueItem } from "@/lib/types";
import { agentAppearanceOverride, projectAgentColor } from "@/lib/agent-appearance";
import { relativeTaskTime, taskPresentation } from "@/lib/work-map";
import { workBody } from "@/lib/work-body";
import { RowActions } from "../RowActions/RowActions";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import styles from "./WorkMap.module.css";

interface Props {
  projectId: string;
  item: QueueItem;
  agents: Agent[];
  colors: Record<string, string>;
  avatars: Record<string, string>;
  parentTitle?: string;
  healthReason?: string;
  onOpen: () => void;
  onCancel?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function WorkMapChildRow({
  projectId,
  item,
  agents,
  colors,
  avatars,
  parentTitle,
  healthReason,
  onOpen,
  onCancel,
  onDelete,
}: Props) {
  const executor = item.executorId || item.agentId;
  const agent = agents.find((candidate) => candidate.id === executor);
  const status = taskPresentation(item);
  const appearanceId = agent?.sourceAgentId || executor;
  const avatar = appearanceId ? agentAppearanceOverride(avatars, projectId, appearanceId) : undefined;
  const color = appearanceId ? projectAgentColor(colors, projectId, appearanceId) : undefined;
  return <div className={styles.childLine} role="listitem">
    <Button variant="inherit" className={styles.childButton} onClick={onOpen}>
      <span className={styles.avatar} style={{
        backgroundColor: color ? `color-mix(in srgb, ${color} 16%, var(--surface-2))` : undefined,
        backgroundImage: avatar ? `url("${avatar}")` : undefined,
        color,
      }}>{!avatar && (executor || "?").slice(0, 2).toUpperCase()}</span>
      <span className={styles.childCopy}>
        <strong data-work-body>{workBody(item)}</strong>
        <span>{agent?.title || executor || "Unassigned"}{parentTitle ? ` · ${parentTitle}` : ""}</span>
        {healthReason && <span className={styles.healthReason}>{healthReason}</span>}
      </span>
      <StatusIndicator className={styles.statusPlacement} status={status.canonical} label={status.label} size="compact" />
      <time dateTime={item.updatedAt} title={item.updatedAt} suppressHydrationWarning>{relativeTaskTime(item.updatedAt)}</time>
    </Button>
    <RowActions
      label={`Actions for delegated action ${workBody(item)}`}
      cancelLabel="Cancel delegated action"
      deleteLabel="Delete delegated action"
      onCancel={onCancel}
      onDelete={onDelete}
    />
  </div>;
}
