import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectNavItem } from "./ProjectNavItem";

const meta = { component: ProjectNavItem, title: "Navigation/ProjectNavItem" } satisfies Meta<typeof ProjectNavItem>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { projectId: "song-team", name: "Song team", count: 5, status: "queued", statusLabel: "5 items queued", menuOpen: false, onClick: () => undefined, onMenu: () => undefined, onContextMenu: () => undefined } };
export const Active: Story = { args: { projectId: "restaurant-menu", name: "Restaurant menu", count: 4, active: true, status: "working", statusLabel: "Chef: Plating the tasting menu", menuOpen: false, onClick: () => undefined, onMenu: () => undefined, onContextMenu: () => undefined } };
export const Idle: Story = { args: { projectId: "archive", name: "Archived experiments", count: 0, status: "idle", statusLabel: "No active work", menuOpen: false, onClick: () => undefined, onMenu: () => undefined, onContextMenu: () => undefined } };
export const NeedsAttention: Story = { args: { projectId: "billing", name: "Billing pipeline", count: 2, status: "failed", statusLabel: "1 agent needs attention", menuOpen: false, onClick: () => undefined, onMenu: () => undefined, onContextMenu: () => undefined } };
