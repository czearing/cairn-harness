import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ArrowRight, Plus, Settings, Trash2 } from "lucide-react";
import { Button } from "./Button";

const meta = {
  component: Button,
  title: "Foundation/Button",
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: { children: "Continue", variant: "primary" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: "secondary", children: "Edit details" } };
export const Loading: Story = { args: { loading: true, children: "Saving" } };
export const Disabled: Story = { args: { disabled: true, children: "Unavailable" } };

export const System: Story = {
  render: () => <main aria-label="Button design system" style={{
    width: "min(720px, calc(100vw - 32px))",
    display: "grid",
    gap: 28,
  }}>
    <header>
      <p style={{ margin: "0 0 7px", color: "var(--text-subtle)", fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase" }}>Foundation</p>
      <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-.03em" }}>One action language.</h1>
      <p style={{ maxWidth: 520, margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14 }}>Quiet hierarchy for creation, navigation, utility, and destructive decisions.</p>
    </header>
    <section style={{ display: "grid", gap: 12 }}>
      <strong style={{ fontSize: 13 }}>Action hierarchy</strong>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Button variant="primary"><Plus size={15} />Create task</Button>
        <Button variant="secondary">Review changes</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger"><Trash2 size={15} />Delete project</Button>
      </div>
    </section>
    <section style={{ display: "grid", gap: 12 }}>
      <strong style={{ fontSize: 13 }}>Scale and state</strong>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <Button variant="secondary" size="compact">Compact</Button>
        <Button variant="primary">Default<ArrowRight size={15} /></Button>
        <Button variant="secondary" size="large">Large action</Button>
        <Button variant="ghost" size="icon" aria-label="Settings"><Settings size={16} /></Button>
        <Button variant="primary" loading>Publishing</Button>
      </div>
    </section>
    <section style={{ display: "grid", gap: 8, maxWidth: 280 }}>
      <strong style={{ fontSize: 13 }}>Menu and surface actions</strong>
      <div style={{ padding: 5, border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface-2)" }}>
        <Button variant="menu">Project workflow</Button>
        <Button variant="menu">Appearance</Button>
      </div>
      <Button variant="surface" size="large">Open agent workspace<ArrowRight size={15} style={{ marginLeft: "auto" }} /></Button>
    </section>
    <section style={{ display: "flex", gap: 4 }}>
      <Button variant="tab" aria-current="page">Overview</Button>
      <Button variant="tab">Recent activity</Button>
    </section>
  </main>,
};
