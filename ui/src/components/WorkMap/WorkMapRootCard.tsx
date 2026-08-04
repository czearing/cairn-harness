import { Button } from "@/components/Button/Button";
import type { Agent, QueueItem } from "@/lib/types";
import { agentAppearanceOverride, projectAgentColor } from "@/lib/agent-appearance";
import { taskPresentation, workMapChildIsHistorical, type WorkMapRoot } from "@/lib/work-map";
import { workBody } from "@/lib/work-body";
import { RowActions } from "../RowActions/RowActions";
import { CardSurface, type CardSurfaceTone } from "../CardSurface/CardSurface";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import { WorkMapChildRow } from "./WorkMapChildRow";
import styles from "./WorkMap.module.css";

interface Props {
  entry: WorkMapRoot;
  projectId: string;
  agents: Agent[];
  colors: Record<string, string>;
  avatars: Record<string, string>;
  onRoot: (item: QueueItem) => void;
  onRootCancel: (item: QueueItem) => Promise<void>;
  onRootDelete: (item: QueueItem) => Promise<void>;
  onChild: (item: QueueItem) => void;
  onChildCancel: (item: QueueItem) => Promise<void>;
  onChildDelete: (item: QueueItem) => Promise<void>;
  historyMode?: boolean;
}

export function WorkMapRootCard({
  entry: { root, children, progress, health },
  projectId,
  agents,
  colors,
  avatars,
  onRoot,
  onRootCancel,
  onRootDelete,
  onChild,
  onChildCancel,
  onChildDelete,
  historyMode = false,
}: Props) {
  const status = taskPresentation(root);
  const accountableAgent = agents.find((candidate) => candidate.id === root.accountableId);
  const ownerId = root.executorId || root.agentId || accountableAgent?.id;
  const owner = agents.find((candidate) => candidate.id === ownerId);
  const ownerLabel = owner?.title || ownerId || "Unassigned";
  const appearanceId = owner?.sourceAgentId || ownerId;
  const avatar = appearanceId ? agentAppearanceOverride(avatars, projectId, appearanceId) : undefined;
  const color = appearanceId ? projectAgentColor(colors, projectId, appearanceId) : undefined;
  const current = historyMode ? children : children.filter((child) => !workMapChildIsHistorical(child));
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const tone: CardSurfaceTone = status.canonical === "running"
    ? "accent"
    : status.canonical === "blocked" || status.canonical === "failed"
      ? "danger"
      : "neutral";

  return <CardSurface className={styles.root} data-status={status.canonical} interactive tone={tone}>
    <div className={styles.rootLine}>
      <Button
        variant="inherit"
        className={styles.rootButton}
        aria-label={`${workBody(root)}. Owner: ${ownerLabel}. ${status.label}${progress.total ? `. ${progress.completed} of ${progress.total} delegated complete` : ""}.`}
        onClick={() => onRoot(root)}
      >
        <span className={styles.rootOverview}>
          <span className={styles.ownerMark} style={{
            backgroundColor: color ? `color-mix(in srgb, ${color} 16%, var(--surface-2))` : undefined,
            backgroundImage: avatar ? `url("${avatar}")` : undefined,
            color,
          }}>{!avatar && (ownerId || "?").slice(0, 2).toUpperCase()}</span>
          <span className={styles.rootCopy}>
            <strong data-work-body title={workBody(root)}>{workBody(root)}</strong>
            <span>{ownerLabel}</span>
          </span>
          <span className={styles.statusStack}>
            <StatusIndicator status={status.canonical} label={status.label} />
          </span>
        </span>
        {progress.total > 0 && <span className={styles.rootProgress}>
          <span className={styles.progressCopy}>
            <span>{progress.completed}/{progress.total} complete</span>
            {(progress.active > 0 || progress.blockedOrFailed > 0) && <span>{progress.active > 0 ? `${progress.active} active` : `${progress.blockedOrFailed} attention`}</span>}
          </span>
          <span className={styles.progressTrack} aria-hidden>
            <span style={{ width: `${percent}%` }} />
          </span>
        </span>}
      </Button>
      <RowActions
        label={`Actions for task ${workBody(root)}`}
        cancelLabel="Cancel task"
        deleteLabel="Delete task"
        onCancel={!status.terminal ? () => onRootCancel(root) : undefined}
        onDelete={status.terminal ? () => onRootDelete(root) : undefined}
      />
    </div>
    {health.length > 0 && <ul className={styles.health} aria-label={`Plan health for ${root.title}`}>
      {health.map((reason) => <li key={reason}>{reason}</li>)}
    </ul>}
    {current.length > 0 && <div className={styles.delegations}>
      <div className={styles.delegationHeading}><span>Tasks</span><strong>{current.length}</strong></div>
      <div className={styles.children} role="list" aria-label={`Delegated tasks for ${root.title}`}>
        {current.map((child) => <WorkMapChildRow
          key={child.id}
          projectId={projectId}
          item={child}
          agents={agents}
          colors={colors}
          avatars={avatars}
          parentTitle={child.parentId === root.id ? root.title : children.find((candidate) => candidate.id === child.parentId)?.title}
          onOpen={() => onChild(child)}
          onCancel={!taskPresentation(child).terminal ? () => onChildCancel(child) : undefined}
          onDelete={taskPresentation(child).terminal ? () => onChildDelete(child) : undefined}
        />)}
      </div>
    </div>}
  </CardSurface>;
}
