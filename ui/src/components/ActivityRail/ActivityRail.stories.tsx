import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActivityRail } from "./ActivityRail";

const timestamp = new Date().toISOString();
const project = {
  id: "cairn",
  name: "Cairn Harness",
  root: "",
  releases: 1,
  agents: [
    { id: "lead", title: "Product lead", role: "Lead", status: "working" as const, updatedAt: timestamp },
    { id: "designer", title: "Interface designer", role: "Design", status: "idle" as const, updatedAt: timestamp },
  ],
  workItems: [],
  delegatedActions: [],
  activity: [
    { id: 4, agent: "lead", summary: "Completed deliverable.", status: "completed", completedAt: timestamp, chatId: "turn:4" },
    { id: 3, agent: "designer", summary: "Completed deliverable.", status: "completed", completedAt: timestamp, chatId: "turn:3" },
    { id: 2, agent: "lead", summary: "Delegated: dashboard shell refinement; mobile geometry review", status: "waiting", completedAt: timestamp, chatId: "turn:2" },
    { id: 1, agent: "designer", summary: "Reviewed responsive pane geometry.", status: "completed", completedAt: timestamp, chatId: "turn:1" },
  ],
  conversations: {},
};

const meta = {
  component: ActivityRail,
  title: "Dashboard/ActivityRail",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: {
    project,
    onClear: () => undefined,
    onOpen: () => undefined,
  },
  decorators: [(Story) => <div style={{ width: 320, minHeight: "100vh", marginLeft: "auto", background: "#0b0c0e" }}><Story /></div>],
} satisfies Meta<typeof ActivityRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { project: { ...project, activity: [] } } };
export const Narrow240: Story = {
  decorators: [(Story) => <div style={{ width: 240, minHeight: "100vh", marginLeft: "auto" }}><Story /></div>],
};
