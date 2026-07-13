import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Dashboard } from "./Dashboard";

const projects = [{
  id: "song-team",
  name: "Three song EP",
  root: "C:\\projects\\song-team",
  releases: 1,
  agents: [
    { id: "idea-manager", role: "EP creative director", status: "working" as const, topic: "song one", updatedAt: "" },
    { id: "lyricist", role: "Lyric writer", status: "idle" as const, updatedAt: "" },
    { id: "composer", role: "Song composer", status: "working" as const, topic: "composition", updatedAt: "" },
  ],
  workItems: [{ id: "1", title: "song-1.md", meta: "work-items/in-progress/song-1.md", status: "in progress" }],
  todos: [{ id: "2", title: "lyrics.todo", meta: "todos/lyrics.todo", status: "delegated" }],
  activity: [{ id: 1, agent: "idea-manager", summary: "Documented EP direction.", status: "completed", completedAt: new Date().toISOString() }],
}];

const meta = { component: Dashboard, title: "Pages/Dashboard", parameters: { layout: "fullscreen" } } satisfies Meta<typeof Dashboard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { initialProjects: projects } };
