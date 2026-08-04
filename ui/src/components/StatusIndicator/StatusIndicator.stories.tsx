import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { StatusKind } from "./StatusIndicator";
import { StatusIndicator } from "./StatusIndicator";

const statuses: StatusKind[] = [
  "healthy", "working", "running", "active", "queued", "waiting",
  "attention", "paused", "idle", "blocked", "failed", "completed", "cancelled",
  "saving", "saved", "unsaved", "sending", "delivered", "replied", "retrying",
  "delegated", "budget-exhausted", "unknown",
];

const meta = {
  component: StatusIndicator,
  title: "Status/StatusIndicator",
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: { status: "working" },
} satisfies Meta<typeof StatusIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Working: Story = {};
export const Compact: Story = { args: { status: "healthy", label: "All systems operational", size: "compact" } };
export const Dot: Story = { args: { status: "running", display: "dot", label: "Project running" } };
export const System: Story = {
  render: () => <main aria-label="Status indicator system" style={{ width: "min(680px, calc(100vw - 32px))", display: "grid", gap: 32 }}>
    <header>
      <p style={{ margin: "0 0 7px", color: "var(--text-subtle)", fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase" }}>Foundation</p>
      <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-.03em" }}>Status, without the badge wall.</h1>
    </header>
    <section style={{ display: "grid", gap: 14 }}>
      <strong style={{ fontSize: 13 }}>Operational states</strong>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
        {statuses.slice(0, 10).map((status) => <StatusIndicator key={status} status={status} />)}
      </div>
    </section>
    <section style={{ display: "grid", gap: 14 }}>
      <strong style={{ fontSize: 13 }}>Workflow and exceptions</strong>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
        {statuses.slice(10).map((status) => <StatusIndicator key={status} status={status} />)}
      </div>
    </section>
    <section style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 18 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Project infrastructure</span>
      <StatusIndicator status="healthy" label="All systems operational" />
    </section>
  </main>,
};
