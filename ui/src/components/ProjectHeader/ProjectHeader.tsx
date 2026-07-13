import { Plus } from "lucide-react";
import styles from "./ProjectHeader.module.css";

interface Props { name: string; root: string; active: number; releases: number; onAdd?: () => void; }

export function ProjectHeader({ name, root, active, releases, onAdd }: Props) {
  return (
    <header className={styles.header}>
      <div><span>Project</span><h1>{name}</h1><p>{root}</p></div>
      <div className={styles.actions}>
        <dl><div><dt>Active</dt><dd>{active}</dd></div><div><dt>Releases</dt><dd>{releases}</dd></div></dl>
        <button onClick={onAdd}><Plus size={14} />New work item</button>
      </div>
    </header>
  );
}
