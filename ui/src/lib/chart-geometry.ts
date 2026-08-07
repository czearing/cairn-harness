import type { AgentSeries, CompletionSeries } from "./completion-series.ts";

export interface ChartGeometry {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  maxTotal: number;
  ticks: number[];
  lines: { agentId: string; total: number; path: string; endX: number; endY: number }[];
}

export interface ChartOptions {
  width?: number;
  height?: number;
  padding?: { left: number; top: number; right: number; bottom: number };
}

const DEFAULT_PADDING = { left: 34, top: 12, right: 12, bottom: 22 };

// The y axis is chosen so the topmost gridline is a round number at or above the peak. A scale that ends
// exactly on the peak puts the busiest agent's final point on the frame edge, where a 1px line is clipped.
export function niceMaximum(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

export function chartGeometry(series: CompletionSeries, options: ChartOptions = {}): ChartGeometry {
  const width = options.width ?? 640;
  const height = options.height ?? 220;
  const padding = { ...DEFAULT_PADDING, ...options.padding };
  const plot = {
    ...padding,
    width: Math.max(1, width - padding.left - padding.right),
    height: Math.max(1, height - padding.top - padding.bottom),
  };
  const peak = Math.max(0, ...series.agents.map((agent) => agent.total));
  const maxTotal = niceMaximum(peak);
  // A cumulative count is zero before the first recorded day, so the left edge is that origin and each
  // day occupies the column after it. Anchoring day zero to the left edge instead would hide the opening
  // rise, and would leave a single-day project as one dot floating with no baseline to read it against.
  const x = (index: number) => plot.left + ((index + 1) / series.days.length) * plot.width;
  const y = (total: number) => plot.top + plot.height - (total / maxTotal) * plot.height;
  const origin = { x: round(plot.left), y: round(y(0)) };
  const lines = series.agents.map((agent) => line(agent, origin, x, y));
  return { width, height, plot, maxTotal, ticks: tickValues(maxTotal), lines };
}

function line(
  agent: AgentSeries,
  origin: { x: number; y: number },
  x: (index: number) => number,
  y: (total: number) => number,
): ChartGeometry["lines"][number] {
  const points = [origin, ...agent.points.map((point, index) => ({
    x: round(x(index)),
    y: round(y(point.total)),
  }))];
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const last = points[points.length - 1];
  return { agentId: agent.agentId, total: agent.total, path, endX: last.x, endY: last.y };
}

function tickValues(maxTotal: number): number[] {
  const divisions = maxTotal % 4 === 0 ? 4 : 2;
  return Array.from({ length: divisions + 1 }, (_, index) => (maxTotal / divisions) * index);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
