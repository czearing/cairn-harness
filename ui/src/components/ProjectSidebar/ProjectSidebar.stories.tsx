import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import type { AgentStatus } from "@/lib/types";
import { ProjectSidebar } from "./ProjectSidebar";

const workItem = (index: number, status: string) => ({
  id: `task-${index}`,
  title: `Work item ${index}`,
  meta: `task-${index}`,
  status,
});
const agent = (status: AgentStatus, topic?: string) => ({
  id: "operator",
  title: "Operator",
  role: "Operator",
  status,
  topic,
  updatedAt: "2026-08-06T00:00:00.000Z",
});
const project = (
  id: string,
  name: string,
  activeWork = 0,
  paused = false,
  agents: ReturnType<typeof agent>[] = [],
) => ({
  id,
  name,
  root: "",
  agents,
  workItems: Array.from({ length: activeWork }, (_, index) => workItem(index, "pending"))
    .concat([workItem(99, "completed")]),
  delegatedActions: [],
  activity: [],
  conversations: {},
  releases: 0,
  paused,
});
const projects = [
  project("cairn", "Cairn Harness", 4, false, [agent("working", "Reviewing PR 5549904")]),
  project("launch", "Launch operations", 2),
  project("research", "Product research"),
  project("archive", "Archived experiments", 0, true),
];
const callbacks = {
  onHealth: () => undefined,
  onSettings: () => undefined,
  onSelect: () => undefined,
  onNew: () => undefined,
  onAppearance: () => undefined,
  onWorkflow: () => undefined,
  onPause: async () => undefined,
  onDelete: async () => undefined,
};

function SidebarHarness() {
  const [selected, setSelected] = useState("cairn");
  return <div style={{ width: 248, minHeight: "100vh" }}>
    <ProjectSidebar
      projects={projects}
      selected={selected}
      colors={{ cairn: "#9ef0c0", launch: "#8ab4f8", research: "#e9c46a", archive: "#96999f" }}
      health={{ status: "healthy", label: "All systems operational", issues: [] }}
      {...callbacks}
      onSelect={setSelected}
    />
  </div>;
}

const meta = {
  component: ProjectSidebar,
  title: "Navigation/ProjectSidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: {
    projects,
    selected: "cairn",
    health: { status: "healthy", label: "All systems operational", issues: [] },
    ...callbacks,
  },
} satisfies Meta<typeof ProjectSidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <SidebarHarness /> };
export const Narrow180: Story = { render: () => <div style={{ width: 180, minHeight: "100vh" }}><ProjectSidebar {...meta.args} /></div> };
export const Wide360: Story = { render: () => <div style={{ width: 360, minHeight: "100vh" }}><ProjectSidebar {...meta.args} /></div> };
export const LongProjectNames: Story = {
  args: { projects: [project("long", "A deliberately long project name that must remain scannable", 128)] },
  render: (args) => <div style={{ width: 220, minHeight: "100vh" }}><ProjectSidebar {...args} /></div>,
};
export const SelectionInteraction: Story = {
  render: () => <SidebarHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Launch operations/ }));
    await expect(canvas.getByRole("button", { name: /Launch operations/ })).toHaveAttribute("aria-current", "page");
  },
};

export const ManyProjects: Story = {
  args: { projects: Array.from({ length: 14 }, (_, index) => project(`p${index}`, `Project ${index + 1}`, index % 4)) },
  render: (args) => <div style={{ width: 248, height: "100vh" }}><ProjectSidebar {...args} /></div>,
};
export const DegradedHealth: Story = {
  args: { health: { status: "attention", label: "One worker is not responding", issues: [] } },
  render: (args) => <div style={{ width: 248, minHeight: "100vh" }}><ProjectSidebar {...args} /></div>,
};
export const EmptyState: Story = {
  args: { projects: [], selected: undefined },
  render: (args) => <div style={{ width: 248, minHeight: "100vh" }}><ProjectSidebar {...args} /></div>,
};
export const ActivityStates: Story = {
  args: {
    selected: "working",
    projects: [
      project("working", "Agent running now", 3, false, [agent("working", "Reviewing PR 5549904")]),
      project("queued", "Work admitted, nothing started", 2),
      project("attention", "Agent needs a human", 1, false, [agent("failed")]),
      project("stopped", "Project paused", 2, true),
      project("quiet", "Nothing happening", 0),
    ],
  },
  render: (args) => <div style={{ width: 248, minHeight: "100vh" }}><ProjectSidebar {...args} /></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Operator: Reviewing PR 5549904")).toBeVisible();
    await expect(canvas.getByLabelText("2 items queued")).toBeVisible();
    await expect(canvas.getByLabelText("1 agent needs attention")).toBeVisible();
    await expect(canvas.getByLabelText("Project paused")).toBeVisible();
    await expect(canvas.getByLabelText("No active work")).toBeVisible();
  },
};
export const ContextMenuOpen: Story = {
  render: () => <SidebarHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /More options for Cairn Harness/ }));
    await expect(await screen.findByRole("menu", { name: /Cairn Harness project actions/ })).toBeVisible();
  },
};
export const KeyboardFocusOrder: Story = {
  render: () => <SidebarHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("button", { name: "New project" }).focus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: /Cairn Harness/ })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: /More options for Cairn Harness/ })).toHaveFocus();
  },
};


