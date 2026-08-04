import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Dashboard } from "./Dashboard";

const projects = [{
  id: "song-team",
  name: "Three song EP",
  root: "C:\\projects\\song-team",
  releases: 1,
  agents: [
    { id: "idea-manager", title: "Idea Manager", role: "EP creative director", status: "working" as const, topic: "Shape song one", updatedAt: "" },
    { id: "lyricist", title: "Lyricist", role: "Lyric writer", status: "idle" as const, updatedAt: "" },
    { id: "composer", title: "Composer", role: "Song composer", status: "working" as const, topic: "Draft composition", updatedAt: "" },
  ],
  workItems: [{ id: "1", title: "song-1.md", meta: "work-items/in-progress/song-1.md", status: "in progress" }],
  delegatedActions: [{ id: "2", title: "Write lyrics", meta: "task:2", status: "claimed", agentId: "lyricist", context: "For Song one" }],
  activity: [{ id: 1, agent: "idea-manager", summary: "Documented EP direction.", status: "completed", completedAt: new Date().toISOString(), chatId: "turn:1" }],
  conversations: {
    "idea-manager": [{ id: "turn:1", sender: "idea-manager", recipient: "team", body: "Documented EP direction.", status: "completed", timestamp: new Date().toISOString(), direction: "outgoing" as const, kind: "turn" as const }],
    lyricist: [],
    composer: [],
  },
}];

const meta = { component: Dashboard, title: "Pages/Dashboard", parameters: { layout: "fullscreen" } } satisfies Meta<typeof Dashboard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { initialProjects: projects, initialPathname: "/projects/song-team", workspaceRoot: "C:\\Users\\caleb\\Cairn Workspaces" } };
