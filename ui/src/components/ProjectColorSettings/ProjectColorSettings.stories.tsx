import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectColorSettings } from "./ProjectColorSettings";

const project = { id: "song-team", name: "Song team", root: "", agents: [], workItems: [], delegatedActions: [], activity: [], releases: 0 };
const meta = { title: "Settings/ProjectColorSettings", component: ProjectColorSettings } satisfies Meta<typeof ProjectColorSettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { projects: [project], colors: {}, onChange: () => undefined } };
