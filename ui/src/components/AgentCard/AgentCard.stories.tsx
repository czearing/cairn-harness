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
    avatarBadge: <Crown size={11} aria-hidden="true" />,
    avatarBadgeLabel: "Project leader",
    avatarBadgeTone: "warning",
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
    avatarBadge: <Sparkles size={11} aria-hidden="true" />,
    avatarBadgeLabel: "Idea agent",
    avatarBadgePlacement: "bottom",
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
