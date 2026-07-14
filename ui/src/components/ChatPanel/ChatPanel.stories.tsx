import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChatPanel } from "./ChatPanel";

const meta = { component: ChatPanel, title: "Agents/ChatPanel", decorators: [(Story) => <div style={{ width: 430, height: 720 }}><Story /></div>] } satisfies Meta<typeof ChatPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const History: Story = { args: {
  agent: { id: "writer", role: "Story writer", status: "working", topic: "draft", updatedAt: "" },
  messages: [
    { id: "1", sender: "concept", recipient: "writer", body: "Write from this concept.", status: "completed", timestamp: new Date().toISOString(), direction: "incoming", kind: "message" },
    { id: "2", sender: "writer", recipient: "team", body: "Draft complete.", status: "completed", timestamp: new Date().toISOString(), direction: "outgoing", kind: "assistant" },
  ],
  olderCount: 0,
  onSend: async () => undefined,
} };
