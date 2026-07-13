import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageBody } from "./MessageBody";

const meta = { title: "Components/MessageBody", component: MessageBody } satisfies Meta<typeof MessageBody>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Markdown: Story = {
  args: { message: { id: "1", sender: "agent", recipient: "human", body: "## Update\n\n- Built the view\n- Added `tests`", status: "recorded", timestamp: "", direction: "outgoing", kind: "assistant" } },
};

export const ToolDetails: Story = {
  args: { message: { id: "2", sender: "agent", recipient: "view", body: '{"path":"src/app.tsx"}', status: "recorded", timestamp: "", direction: "outgoing", kind: "tool" } },
};
