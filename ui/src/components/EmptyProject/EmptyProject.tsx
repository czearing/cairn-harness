import { Button } from "@/components/Button/Button";
import styles from "../Dashboard/Dashboard.module.css";

export function EmptyProject({ onCreate }: { onCreate: () => void }) {
  return <main className={styles.empty}>
    <h1>No projects yet</h1>
    <p>Create a project and add your agents.</p>
    <Button variant="primary" onClick={onCreate}>Create project</Button>
  </main>;
}
