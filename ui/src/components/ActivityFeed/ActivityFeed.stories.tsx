import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import type { Activity } from "@/lib/types";
import { ActivityFeed } from "./ActivityFeed";

const now = new Date().toISOString();
const agents = [
  { id: "lead", title: "Product lead", role: "Lead", status: "working" as const, updatedAt: now },
  { id: "designer", title: "Interface designer", role: "Design", status: "idle" as const, updatedAt: now },
];
const activity: Activity[] = [
  { id: 6, agent: "lead", status: "completed", summary: "Completed deliverable.", completedAt: now, chatId: "turn:6" },
  { id: 5, agent: "designer", status: "completed", summary: "Completed deliverable.", completedAt: now, chatId: "turn:5" },
  { id: 4, agent: "lead", status: "waiting", summary: "Delegated: Refine dashboard hierarchy; verify mobile geometry", completedAt: now, chatId: "turn:4" },
  { id: 3, agent: "removed-agent", status: "completed", summary: "Completed deliverable.", completedAt: now, chatId: "turn:3" },
  { id: 2, agent: "designer", status: "completed", summary: "Completed responsive activity rail review.", completedAt: now, chatId: "turn:2" },
  { id: 1, agent: "lead", status: "failed", summary: "Activity projection timed out.", completedAt: now, chatId: "turn:1" },
];

const meta = {
  component: ActivityFeed,
  title: "Activity/ActivityFeed",
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: { activity, agents, onOpen: () => undefined },
  decorators: [(Story) => <div style={{ width: 300, minHeight: 520, padding: 10, border: "1px solid var(--border)", background: "var(--canvas)" }}><Story /></div>],
} satisfies Meta<typeof ActivityFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};
export const Empty: Story = { args: { activity: [] } };
export const GenericOnly: Story = { args: { activity: activity.filter((item) => item.summary === "Completed deliverable.") } };
export const Narrow220: Story = {
  decorators: [(Story) => <div style={{ width: 220, minHeight: 520, padding: 8, border: "1px solid var(--border)", background: "var(--canvas)" }}><Story /></div>],
};
export const MinimalNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/routine completions/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText("Completed deliverable")).not.toBeInTheDocument();
    await expect(canvas.getByText("Delegated Refine dashboard hierarchy")).toBeVisible();
    await expect(canvas.getByText("Failed: Activity projection timed out")).toBeVisible();
  },
};
