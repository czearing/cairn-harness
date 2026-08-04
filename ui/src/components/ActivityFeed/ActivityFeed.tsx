import type { Activity, Agent } from "@/lib/types";
import { buildActivityFeed } from "@/lib/activity-feed";
import { ActivityRow } from "../ActivityRow/ActivityRow";
import styles from "./ActivityFeed.module.css";

interface Props {
  activity: Activity[];
  agents: Agent[];
  onOpen: (agent: Agent, focusId: string) => void;
}

export function ActivityFeed({ activity, agents, onOpen }: Props) {
  const items = buildActivityFeed(activity);
  if (!items.length) return <div className={styles.empty}>No recent updates</div>;

  return <div className={styles.feed}>
    {items.map((item) => <FeedRow key={item.id} activity={item} agents={agents} onOpen={onOpen} />)}
  </div>;
}

function FeedRow({ activity, agents, onOpen }: {
  activity: Activity;
  agents: Agent[];
  onOpen: Props["onOpen"];
}) {
  const agent = agents.find((candidate) => candidate.id === activity.agent);
  return <ActivityRow
    activity={activity}
    agentLabel={agent?.title || activity.agent}
    agentRemoved={!agent}
    onClick={agent ? () => onOpen(agent, activity.chatId) : undefined}
  />;
}
