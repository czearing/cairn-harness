import styles from "../Dashboard/Dashboard.module.css";

export function EmptyProject({ onCreate }: { onCreate: () => void }) {
  return <main className={styles.empty}>
    <h1>No projects yet</h1>
    <p>Create a project and add your agents.</p>
    <button onClick={onCreate}>Create project</button>
  </main>;
}
