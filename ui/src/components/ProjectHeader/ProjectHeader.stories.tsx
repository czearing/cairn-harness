import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectHeader } from "./ProjectHeader";

const meta = { component: ProjectHeader, title: "Projects/ProjectHeader", parameters: { layout: "padded" } } satisfies Meta<typeof ProjectHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { name: "Song team", root: "C:\\projects\\song-team", active: 2, releases: 1 } };
