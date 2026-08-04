import { AlertTriangle, History, Inbox } from "lucide-react";
import type { Agent, QueueItem } from "@/lib/types";
import { Accordion } from "../Accordion/Accordion";
import { assembleWorkMap, taskPresentation, workMapChildIsHistorical, workMapOrphanIsHistorical, workMapRootIsHistorical } from "@/lib/work-map";
import { WorkMapChildRow } from "./WorkMapChildRow";
import { WorkMapRootCard } from "./WorkMapRootCard";
import { CardSurface } from "../CardSurface/CardSurface";
import styles from "./WorkMap.module.css";

export interface WorkMapProps {
  projectId: string;
  agents: Agent[];
  colors: Record<string, string>;
  avatars: Record<string, string>;
  roots: QueueItem[];
  delegated: QueueItem[];
  onRoot: (item: QueueItem) => void;
  onRootCancel: (item: QueueItem) => Promise<void>;
  onRootDelete: (item: QueueItem) => Promise<void>;
  onChild: (item: QueueItem) => void;
  onChildCancel: (item: QueueItem) => Promise<void>;
  onChildDelete: (item: QueueItem) => Promise<void>;
}

export function WorkMap({
  projectId,
  agents,
  colors,
  avatars,
  roots,
  delegated,
  onRoot,
  onRootCancel,
  onRootDelete,
  onChild,
  onChildCancel,
  onChildDelete,
}: WorkMapProps) {
  const map = assembleWorkMap(roots, delegated);
  const historical = map.roots.filter(workMapRootIsHistorical);
  const current = map.roots.filter((entry) => !historical.includes(entry));
  const historicalOrphans = map.orphans.filter(({ item }) => workMapOrphanIsHistorical(item));
  const currentOrphans = map.orphans.filter(({ item }) => !workMapOrphanIsHistorical(item));
  const historicalChildren = current.flatMap((entry) => entry.children
    .filter(workMapChildIsHistorical)
    .map((item) => ({ item, parentTitle: entry.root.title })));
  const historyCount = historical.reduce((total, entry) => total + 1 + entry.children.length, 0)
    + historicalChildren.length + historicalOrphans.length;
  const rootProps = { projectId, agents, colors, avatars, onRoot, onRootCancel, onRootDelete, onChild, onChildCancel, onChildDelete };
  return <div className={styles.map}>
    {current.map((entry) => <WorkMapRootCard key={entry.root.id} entry={entry} {...rootProps} />)}
    {currentOrphans.length > 0 && <CardSurface as="section" className={`${styles.root} ${styles.orphans}`} tone="danger" aria-labelledby="orphaned-delegations">
      <div className={styles.orphanHeading}>
        <span className={styles.orphanIcon}><AlertTriangle size={15} aria-hidden /></span>
        <div><h3 id="orphaned-delegations">Orphaned delegations</h3>
        <span>Delegations whose hierarchy cannot be resolved.</span>
        </div>
      </div>
      <div className={styles.children} role="list">
        {currentOrphans.map(({ item: child, reason }) => <WorkMapChildRow
          key={child.id}
          projectId={projectId}
          item={child}
          agents={agents}
          colors={colors}
          avatars={avatars}
          parentTitle={currentOrphans.find((candidate) => candidate.item.id === child.parentId)?.item.title}
          healthReason={reason === "cycle"
            ? "Plan health: delegation cycle detected."
            : "Plan health: parent task is missing."}
          onOpen={() => onChild(child)}
          onCancel={!taskPresentation(child).terminal ? () => onChildCancel(child) : undefined}
          onDelete={taskPresentation(child).terminal ? () => onChildDelete(child) : undefined}
        />)}
      </div>
    </CardSurface>}
    {historyCount > 0 && <Accordion icon={<History size={14} aria-hidden />} label={`History (${historyCount})`}>
      {historical.map((entry) => <WorkMapRootCard key={entry.root.id} entry={entry} historyMode {...rootProps} />)}
      <div className={styles.children} role="list" aria-label="Historical delegations">
        {[...historicalChildren, ...historicalOrphans.map(({ item }) => ({ item, parentTitle: undefined }))].map(({ item: child, parentTitle }) => <WorkMapChildRow
          key={child.id}
          projectId={projectId}
          item={child}
          agents={agents}
          colors={colors}
          avatars={avatars}
          parentTitle={parentTitle}
          onOpen={() => onChild(child)}
          onDelete={() => onChildDelete(child)}
        />)}
      </div>
    </Accordion>}
    {!current.length && !currentOrphans.length && <div className={styles.empty}>
      <span className={styles.emptyIcon}><Inbox size={20} aria-hidden /></span>
      <strong>No active work</strong>
      <span>Your team is clear. Use New task when you are ready to start the next initiative.</span>
    </div>}
  </div>;
}
