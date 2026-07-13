import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectNavItem } from "./ProjectNavItem";

const meta = { component: ProjectNavItem, title: "Navigation/ProjectNavItem" } satisfies Meta<typeof ProjectNavItem>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { name: "Song team", count: 5 } };
export const Active: Story = { args: { name: "Restaurant menu", count: 4, active: true } };
