import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IdentityMark } from "./IdentityMark";

const meta = {
  component: IdentityMark,
  title: "Identity/IdentityMark",
  parameters: { a11y: { test: "error" } },
  args: { name: "Cairn Harness" },
} satisfies Meta<typeof IdentityMark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Small: Story = { args: { size: "sm" } };
export const Tinted: Story = { args: { color: "#9ef0c0" } };
export const Avatar: Story = {
  args: { avatarUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%238ab4f8'/%3E%3C/svg%3E" },
};
export const Matrix: Story = {
  render: () => <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <IdentityMark name="Cairn Harness" size="sm" color="#9ef0c0" />
    <IdentityMark name="Launch operations" size="md" color="#8ab4f8" />
    <IdentityMark name="?" size="md" />
  </div>,
};
