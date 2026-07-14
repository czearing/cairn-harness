import { Sparkles } from "lucide-react";
import type { Project } from "@/lib/types";
import styles from "./AutomationCard.module.css";

export function AutomationCard({ project, onConfigure }: { project: Project; onConfigure: () => void }) {
  const producer = project.agents.find((agent) => agent.id === project.producerId);
  const count = project.generatedWorkCount || 0;
  return <section className={styles.card}>
    <span><Sparkles size={15} /></span>
    <div><strong>Automatic work</strong>{producer
      ? <p>{producer.id} · {count} of {project.producerLimit} created</p>
      : <p>Create the next task when the queue is empty.</p>}</div>
    <button onClick={onConfigure}>{producer ? "Manage" : "Set up"}</button>
  </section>;
}
