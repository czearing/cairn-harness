import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { ProjectSidebar } from "./ProjectSidebar";

const project = (id: string, name: string, activeWorkCount = 0, paused = false) => ({
  id,
  name,
  root: "",
  agents: [],
  workItems: [],
  delegatedActions: [],
  activity: [],
  conversations: {},
  releases: 0,
  activeWorkCount,
  paused,
});
const projects = [
  project("cairn", "Cairn Harness", 4),
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


