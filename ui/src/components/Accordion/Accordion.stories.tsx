import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { History } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";
import { Accordion } from "./Accordion";

const meta = {
  title: "Foundation/Accordion",
  component: Accordion,
  parameters: { layout: "centered" },
  decorators: [(Story) => <div style={{ width: "min(36rem, calc(100vw - 2rem))" }}><Story /></div>],
  args: {
    icon: <History size={14} aria-hidden />,
    label: "History (3)",
    children: <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 14 }}>Historical content</div>,
  },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
export const WithoutIcon: Story = { args: { icon: undefined, label: "Advanced settings" } };
export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByText("History (3)");
    await userEvent.click(toggle);
    await expect(canvas.getByText("Historical content")).toBeVisible();
  },
};
