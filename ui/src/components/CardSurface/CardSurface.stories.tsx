import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CardSurface } from "./CardSurface";

const meta = {
  title: "Foundation/Card surface",
  component: CardSurface,
  parameters: { layout: "centered" },
  decorators: [(Story) => <div style={{ width: "min(24rem, calc(100vw - 2rem))" }}><Story /></div>],
  args: {
    children: <div style={{ padding: 16 }}>Shared product surface</div>,
  },
} satisfies Meta<typeof CardSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Interactive: Story = { args: { interactive: true } };
export const Accent: Story = { args: { interactive: true, tone: "accent" } };
export const Warning: Story = { args: { interactive: true, tone: "warning" } };
export const Danger: Story = { args: { interactive: true, tone: "danger" } };
