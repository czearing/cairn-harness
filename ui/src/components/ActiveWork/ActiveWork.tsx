import type { QueueItem } from "@/lib/types";
import { assembleWorkMap, taskPresentation, workMapRootIsHistorical } from "@/lib/work-map";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import { WorkMap, type WorkMapProps } from "../WorkMap/WorkMap";
import styles from "./ActiveWork.module.css";

export function ActiveWork(props: WorkMapProps) {
  const map = assembleWorkMap(props.roots, props.delegated);
  const currentRoots = map.roots.filter((entry) => !workMapRootIsHistorical(entry));
  const activeCount = [
    ...currentRoots.map((entry) => entry.root),
    ...props.delegated,
  ].filter((item) => taskPresentation(item).active).length;
  const attentionCount = currentRoots.filter((entry) =>
    taskPresentation(entry.root).attention || entry.health.length > 0).length
    + map.orphans.filter(({ item }) => !taskPresentation(item).terminal).length;

  return <section className={styles.panel} aria-labelledby="active-work-heading">
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 id="active-work-heading">Active work</h2>
      </div>
      <div className={styles.headerActions}>
        <WorkSummary roots={currentRoots.map((entry) => entry.root)} activeCount={activeCount} attentionCount={attentionCount} />
      </div>
    </header>
    <WorkMap {...props} />
  </section>;
}

function WorkSummary({
  roots,
  activeCount,
  attentionCount,
}: {
  roots: QueueItem[];
  activeCount: number;
  attentionCount: number;
}) {
  return <div className={styles.summary} aria-label={`${roots.length} initiatives, ${activeCount} active tasks, ${attentionCount} needing attention`}>
    <StatusIndicator status={activeCount > 0 ? "active" : "idle"} label={`${activeCount} active`} size="compact" />
    {attentionCount > 0 && <StatusIndicator status="attention" label={`${attentionCount} attention`} size="compact" />}
  </div>;
}
