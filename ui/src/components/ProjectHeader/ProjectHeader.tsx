import { Button } from "@/components/Button/Button";
import { Plus } from "lucide-react";
import { Typography } from "../Typography/Typography";
import styles from "./ProjectHeader.module.css";

interface Props { name: string; root: string; onAdd?: (keyboardFocus: boolean) => void; }

export function ProjectHeader({ name, root, onAdd }: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <Typography as="h1" variant="titleLarge">{name}</Typography>
        <Typography as="p" variant="mono" tone="muted" className={styles.path} title={root} tabIndex={0}>{root}</Typography>
      </div>
      <div className={styles.actions}>
        {onAdd && <Button variant="primary" data-new-task onClick={(event) => onAdd(event.currentTarget.matches(":focus-visible"))}><Plus size={14} />New task</Button>}
      </div>
    </header>
  );
}
