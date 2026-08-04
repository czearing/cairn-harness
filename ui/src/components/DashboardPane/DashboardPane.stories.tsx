import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Activity, FolderKanban, Settings } from "lucide-react";
import { Button } from "@/components/Button/Button";
import { DashboardPane, DashboardPaneBody, DashboardPaneFooter, DashboardPaneHeader } from "./DashboardPane";

const meta = {
  title: "Dashboard/DashboardPane",
  component: DashboardPane,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  decorators: [(Story) => <div style={{ minHeight: "100vh", display: "flex", background: "#0b0c0e" }}><Story /></div>],
} satisfies Meta<typeof DashboardPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Navigation: Story = {
  args: {
    "aria-label": "Project navigation",
    tone: "navigation",
    style: { width: 248, minHeight: "100vh", display: "flex", flexDirection: "column", borderRight: "1px solid #282c32" },
    children: <>
      <DashboardPaneHeader style={{ padding: 18, borderBottom: "1px solid #282c32" }}>
        <strong>Harness</strong>
      </DashboardPaneHeader>
      <DashboardPaneBody style={{ padding: 12 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "#858991", fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Projects</span>
          <Button variant="surface"><FolderKanban size={14} /> Cairn Harness</Button>
        </div>
      </DashboardPaneBody>
      <DashboardPaneFooter style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #282c32" }}>
        <Button variant="ghost" size="icon" aria-label="Global settings"><Settings size={15} /></Button>
      </DashboardPaneFooter>
    </>,
  },
};

export const UtilityRail: Story = {
  args: {
    "aria-label": "Recent activity",
    tone: "utility",
    style: { width: 300, minHeight: "100vh", display: "flex", flexDirection: "column", borderLeft: "1px solid #282c32" },
    children: <>
      <DashboardPaneHeader style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 52, padding: "0 16px", borderBottom: "1px solid #282c32" }}>
        <Activity size={15} /><strong>Recent activity</strong>
      </DashboardPaneHeader>
      <DashboardPaneBody style={{ padding: 12, color: "#96999f" }}>Agent updates flow here without changing the pane shell.</DashboardPaneBody>
    </>,
  },
};
