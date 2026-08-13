import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { completionSeries } from "@/lib/completion-series";
import { CompletionChart } from "./CompletionChart";

const events = (agentId: string, days: [string, number][]) =>
  days.flatMap(([day, count]) => Array.from({ length: count }, () => ({ agentId, completedAt: `${day}T12:00:00Z` })));

const realistic = completionSeries([
  ...events("pr-reviewer", [["2026-07-22", 3], ["2026-07-24", 6], ["2026-07-28", 9], ["2026-08-02", 7], ["2026-08-06", 11]]),
  ...events("repo-1-developer", [["2026-07-22", 5], ["2026-07-26", 8], ["2026-07-31", 12], ["2026-08-04", 4]]),
  ...events("livesite-agent", [["2026-07-25", 2], ["2026-07-29", 6], ["2026-08-05", 9]]),
], "UTC");

const meta = {
  component: CompletionChart,
  title: "Analytics/CompletionChart",
  parameters: { a11y: { test: "error" } },
  args: { series: realistic },
  decorators: [(Story) => <div style={{ width: 560, padding: 20, background: "var(--surface-2)" }}><Story /></div>],
} satisfies Meta<typeof CompletionChart>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("82")).toBeVisible();
    await expect(canvas.getByText(/items completed · Jul 22/)).toBeVisible();
    await expect(canvas.getByRole("row", { name: /repo-1-developer 29/ })).toBeVisible();
  },
};

export const SingleAgent: Story = {
  args: { series: completionSeries(events("solo", [["2026-08-01", 2], ["2026-08-03", 5]]), "UTC") },
};

export const SingleDay: Story = {
  args: { series: completionSeries(events("solo", [["2026-08-05", 1]]), "UTC") },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/item completed · Aug 5/)).toBeVisible();
  },
};

export const Empty: Story = {
  args: { series: completionSeries([], "UTC") },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No work has been completed yet.")).toBeVisible();
  },
};

export const ManyAgents: Story = {
  args: {
    series: completionSeries(
      Array.from({ length: 9 }, (_, index) => events(`agent-${index}`, [["2026-08-01", index + 1], ["2026-08-06", index + 2]])).flat(),
      "UTC",
    ),
  },
};

export const LongRange: Story = {
  args: {
    series: completionSeries(
      Array.from({ length: 400 }, (_, index) => ({
        agentId: `agent-${index % 3}`,
        completedAt: new Date(Date.UTC(2026, 0, 1 + Math.floor(index / 2), 12)).toISOString(),
      })),
      "UTC",
    ),
  },
};

export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 260, padding: 12, background: "var(--surface-2)" }}><Story /></div>],
};
