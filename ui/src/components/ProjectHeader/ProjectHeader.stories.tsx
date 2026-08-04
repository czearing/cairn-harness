import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectHeader } from "./ProjectHeader";

const meta = { component: ProjectHeader, title: "Projects/ProjectHeader", parameters: { layout: "padded" } } satisfies Meta<typeof ProjectHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { name: "Song team", root: "C:\\projects\\song-team" } };
export const LongWindowsPath: Story = { args: { ...Default.args, root: "C:\\Users\\operator\\Documents\\GitHub\\enterprise-platform\\packages\\operator-dashboard" } };
export const LongUnixPath: Story = { args: { ...Default.args, root: "/Users/operator/workspaces/client-delivery/enterprise-platform/packages/operator-dashboard" } };
