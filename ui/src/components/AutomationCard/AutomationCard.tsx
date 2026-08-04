import { Button } from "@/components/Button/Button";
import { Sparkles } from "lucide-react";
import type { Project } from "@/lib/types";
import styles from "./AutomationCard.module.css";

type AutomationState = {
  action: "Set up" | "Manage";
  description: string;
};

function automationState(project: Project): AutomationState {
  const count = project.ideaAgents?.length || 0;
  return {
    action: count ? "Manage" : "Set up",
    description: `${project.delegatedTaskCount || 0}/${project.leaderTaskLimit || 3} active delegations · ${project.backlogTaskCount || 0} backlog · ${count} idea agent${count === 1 ? "" : "s"}`,
  };
}

export function AutomationCard({ project, onConfigure }: { project: Project; onConfigure: () => void }) {
  const state = automationState(project);
  return <section className={styles.card}>
    <span><Sparkles size={15} /></span>
    <div><strong>Leadership and ideas</strong><p>{state.description}</p></div>
    <Button variant="secondary" size="compact" onClick={onConfigure}>{state.action}</Button>
  </section>;
}
