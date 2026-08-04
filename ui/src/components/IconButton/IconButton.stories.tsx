import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react";
import { IconButton } from "./IconButton";

const meta = {
  component: IconButton,
  title: "Controls/IconButton",
  parameters: { a11y: { test: "error" } },
  args: { label: "New project", children: <Plus size={14} /> },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Compact: Story = { args: { size: "compact", label: "More options", children: <MoreHorizontal size={14} /> } };
export const Danger: Story = { args: { variant: "danger", label: "Delete project", children: <Trash2 size={15} /> } };
export const Disabled: Story = { args: { disabled: true, label: "Global settings", children: <Settings size={15} /> } };
export const SizeMatrix: Story = {
  render: (args) => <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <IconButton {...args} size="compact" label="Compact action"><MoreHorizontal size={14} /></IconButton>
    <IconButton {...args} size="default" label="Default action"><Settings size={15} /></IconButton>
  </div>,
};
