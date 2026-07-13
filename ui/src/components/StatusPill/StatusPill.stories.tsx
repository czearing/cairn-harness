import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusPill } from "./StatusPill";

const meta = { component: StatusPill, title: "Status/StatusPill" } satisfies Meta<typeof StatusPill>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Working: Story = { args: { status: "working" } };
export const Idle: Story = { args: { status: "idle" } };
export const Failed: Story = { args: { status: "failed" } };
