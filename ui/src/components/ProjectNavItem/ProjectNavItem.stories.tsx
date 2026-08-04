import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectNavItem } from "./ProjectNavItem";

const meta = { component: ProjectNavItem, title: "Navigation/ProjectNavItem" } satisfies Meta<typeof ProjectNavItem>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { projectId: "song-team", name: "Song team", count: 5, menuOpen: false, onClick: () => undefined, onMenu: () => undefined, onContextMenu: () => undefined } };
export const Active: Story = { args: { projectId: "restaurant-menu", name: "Restaurant menu", count: 4, active: true, menuOpen: false, onClick: () => undefined, onMenu: () => undefined, onContextMenu: () => undefined } };
