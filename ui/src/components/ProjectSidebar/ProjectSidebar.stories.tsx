import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectSidebar } from "./ProjectSidebar";

const project = { id: "one", name: "Song team", root: "", agents: [], workItems: [], todos: [], activity: [], conversations: {}, releases: 0 };
const meta = { component: ProjectSidebar, title: "Navigation/ProjectSidebar", parameters: { layout: "fullscreen" } } satisfies Meta<typeof ProjectSidebar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { projects: [project], selected: "one", onSelect: () => undefined, onNew: () => undefined, onSettings: () => undefined } };
