import { useId } from "react";
import type { CSSProperties } from "react";
import { agentColor } from "@/lib/colors";
import { chartGeometry } from "@/lib/chart-geometry";
import type { CompletionSeries } from "@/lib/completion-series";
import styles from "./CompletionChart.module.css";

interface Props {
  series: CompletionSeries;
  colors?: Record<string, string>;
  titles?: Record<string, string>;
  emptyMessage?: string;
  className?: string;
}

const WIDTH = 640;
const HEIGHT = 200;

function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date))
    .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function CompletionChart({ series, colors = {}, titles = {}, emptyMessage, className = "" }: Props) {
  const gradientId = useId();
  const geometry = chartGeometry(series, { width: WIDTH, height: HEIGHT });
  const baseline = geometry.plot.top + geometry.plot.height;
  const first = series.days[0];
  const last = series.days[series.days.length - 1];
  if (!series.agents.length) {
    return <div className={`${styles.chart} ${className}`}>
      <p className={styles.empty}>{emptyMessage || "No work has been completed yet."}</p>
    </div>;
  }
  const range = first === last ? dayLabel(last) : `${dayLabel(first)} – ${dayLabel(last)}`;
  // Only the floor and the peak are labelled. The exact figure for each agent is read from the legend, so
  // repeating every intermediate gridline value asks the eye to dismiss numbers it never needed.
  const labelled = new Set([geometry.ticks[0], geometry.ticks[geometry.ticks.length - 1]]);
  return <div className={`${styles.chart} ${className}`}>
    <div className={styles.summary}>
      <span className={styles.total}>{series.total}</span>
      <span className={styles.totalLabel}>
        {series.total === 1 ? "item" : "items"} completed · {range}
      </span>
    </div>
    {/* The svg is decorative: every number it draws is also published in the table below, which is the
        accessible equivalent. Colour is never the only carrier of identity, since each row names its
        agent and its count. */}
    <svg className={styles.canvas} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {geometry.ticks.map((tick) => {
        const y = baseline - (tick / geometry.maxTotal) * geometry.plot.height;
        return <g key={tick}>
          <line
            className={styles.gridline}
            x1={geometry.plot.left}
            x2={geometry.plot.left + geometry.plot.width}
            y1={y}
            y2={y}
            vectorEffect="non-scaling-stroke"
          />
          {labelled.has(tick)
            ? <text className={styles.tick} x={geometry.plot.left - 8} y={y + 3} textAnchor="end">{tick}</text>
            : null}
        </g>;
      })}
      {geometry.lines.map((line) => <g
        key={line.agentId}
        style={{ "--chart-line": agentColor(line.agentId, colors) } as CSSProperties}
      >
        <path
          className={styles.area}
          d={`${line.path} L ${line.endX} ${baseline} L ${geometry.plot.left} ${baseline} Z`}
          fill={`url(#${gradientId})`}
        />
        <path className={styles.line} d={line.path} vectorEffect="non-scaling-stroke" />
        <circle className={styles.head} cx={line.endX} cy={line.endY} r="3.5" />
      </g>)}
    </svg>
    <div className={styles.axis} aria-hidden="true">
      {first === last
        ? <span>{dayLabel(last)}</span>
        : <><span>{dayLabel(first)}</span><span>{dayLabel(last)}</span></>}
    </div>
    <table className={styles.legend}>
      <caption className={styles.srOnly}>
        Work completed per agent, {range}
      </caption>
      {/* The header still names both columns for a screen reader, which reads the table without the
          surrounding chart. On screen the two columns are self-evident, so it is not drawn. */}
      <thead className={styles.srOnly}>
        <tr><th scope="col">Agent</th><th scope="col">Completed</th></tr>
      </thead>
      <tbody>
        {series.agents.map((agent) => <tr key={agent.agentId}>
          <th scope="row">
            <span
              className={styles.swatch}
              style={{ background: agentColor(agent.agentId, colors) }}
              aria-hidden="true"
            />
            <span className={styles.name}>{titles[agent.agentId] || agent.agentId}</span>
          </th>
          <td>{agent.total}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
