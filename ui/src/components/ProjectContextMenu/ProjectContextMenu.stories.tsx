import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectContextMenu } from "./ProjectContextMenu";

const project = { id: "ui-polish-team", name: "UI polish team", root: "", agents: [], workItems: [], todos: [], activity: [], releases: 0 };
const meta = { title: "Navigation/ProjectContextMenu", component: ProjectContextMenu, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ProjectContextMenu>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Running: Story = { args: { project, x: 24, y: 24, color: "#9ef0c0", onAppearance: () => undefined, onPause: async () => undefined, onDelete: async () => undefined, onClose: () => undefined } };
