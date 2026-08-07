"use client";

import useSWR from "swr";
import { completionSeries, type CompletionEvent } from "@/lib/completion-series";
import { projectAgentColor } from "@/lib/agent-appearance";
import { fetchJson } from "../Dashboard/dashboard-data";
import { CompletionChart } from "../CompletionChart/CompletionChart";
import styles from "./AnalyticsPanel.module.css";

interface AnalyticsPayload {
  events: CompletionEvent[];
  agents: { id: string; title: string }[];
}

function isAnalytics(value: unknown): value is AnalyticsPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as AnalyticsPayload;
  return Array.isArray(candidate.events) && Array.isArray(candidate.agents);
}

interface Props {
  projectId: string;
  colors?: Record<string, string>;
  refreshInterval?: number;
}

export function AnalyticsPanel({ projectId, colors = {}, refreshInterval = 60_000 }: Props) {
  const { data, error } = useSWR<AnalyticsPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/analytics`,
    (url: string) => fetchJson(url, "Could not load completion analytics", isAnalytics),
    // Completion history is a trend, not live state, so it revalidates slowly. keepPreviousData holds the
    // last chart while switching projects instead of collapsing the panel back to its loading message.
    { refreshInterval, revalidateOnFocus: false, keepPreviousData: true },
  );
  // Bucketing runs here, not on the server, because only the browser knows the operator's time zone.
  const series = completionSeries(data?.events || []);
  const titles = Object.fromEntries((data?.agents || []).map((agent) => [agent.id, agent.title]));
  // The chart takes a flat id to colour map, so the per-project override is resolved here.
  const palette = Object.fromEntries(series.agents.map((agent) => [
    agent.agentId,
    projectAgentColor(colors, projectId, agent.agentId),
  ]));
  return <section className={styles.panel} aria-labelledby="throughput-heading">
    <div className={styles.head}>
      <h2 id="throughput-heading">Completed work over time</h2>
    </div>
    {error
      ? <p className={styles.error} role="alert">{error instanceof Error ? error.message : "Could not load completion analytics"}</p>
      : !data
        ? <p className={styles.loading}>Loading completion history…</p>
        : <CompletionChart
          series={series}
          colors={palette}
          titles={titles}
          emptyMessage="No work has been completed in this project yet."
        />}
  </section>;
}
