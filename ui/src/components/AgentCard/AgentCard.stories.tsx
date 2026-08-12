import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Crown, Sparkles } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { AgentCardSurface, type AgentCardSurfaceProps } from "./AgentCardSurface";

const actions = {
  onPrimary: fn(),
  onConfigure: fn(),
};

const baseArgs: AgentCardSurfaceProps = {
  agentId: "product-designer",
  variant: "agent",
  title: "Product designer",
  initials: "PD",
  status: "idle",
  color: "#a78bfa",
  capability: { label: "Status only", detail: "Can check team status, but cannot delegate or message other agents." },
  primaryLabel: "Open conversation with Product designer",
  settingsLabel: "Configure Product designer",
  ...actions,
};

const meta = {
  component: AgentCardSurface,
  title: "Agents/Agent card",
  parameters: { layout: "centered" },
  args: baseArgs,
  decorators: [
    (Story) => <div style={{ width: "min(18rem, calc(100vw - 2rem))" }}><Story /></div>,
  ],
} satisfies Meta<typeof AgentCardSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Leader: Story = {
  args: {
    agentId: "delivery-lead",
    variant: "leader",
    title: "Delivery lead",
    initials: "DL",
    status: "working",
    color: "#f6c453",
    avatarBadges: [{ icon: <Crown size={11} aria-hidden="true" />, label: "Project leader", placement: "top", tone: "warning" }],
    capability: { label: "Delegates work", detail: "Can delegate tasks and message any agent directly." },
    primaryLabel: "Open conversation with Delivery lead",
    settingsLabel: "Configure Delivery lead",
  },
};

export const IdeaAgent: Story = {
  args: {
    agentId: "opportunity-scout",
    title: "Opportunity scout",
    initials: "OS",
    color: "#34d399",
    avatarBadges: [{ icon: <Sparkles size={11} aria-hidden="true" />, label: "Idea agent", placement: "bottom", tone: "info" }],
    capability: { label: "Files new work", detail: "Can create new tasks, but never contacts other agents." },
  },
};

export const LeaderAndIdeaAgent: Story = {
  args: {
    agentId: "idea-generator",
    variant: "leader",
    title: "Idea generator",
    initials: "IG",
    status: "working",
    color: "#f6c453",
    avatarBadges: [
      { icon: <Crown size={11} aria-hidden="true" />, label: "Project leader", placement: "top", tone: "warning" },
      { icon: <Sparkles size={11} aria-hidden="true" />, label: "Idea agent", placement: "bottom", tone: "info" },
    ],
    capability: { label: "Delegates work", detail: "Can delegate tasks and message any agent directly." },
    primaryLabel: "Open conversation with Idea generator",
    settingsLabel: "Configure Idea generator",
  },
};

export const Statuses: Story = {
  parameters: { layout: "padded" },
  render: () => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "0.875rem", width: "min(64rem, calc(100vw - 2rem))" }}>
    {(["idle", "working", "paused", "failed"] as const).map((status) =>
      <AgentCardSurface key={status} {...baseArgs} agentId={`${status}-agent`} title={`${status[0].toUpperCase()}${status.slice(1)} agent`} status={status} />)}
  </div>,
};

export const LongTitle: Story = {
  args: {
    title: "Principal experience architect for multi-agent systems",
    status: "working",
  },
};

export const Interactions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: baseArgs.primaryLabel }));
    await expect(actions.onPrimary).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: baseArgs.settingsLabel }));
    await expect(actions.onConfigure).toHaveBeenCalled();
  },
};
