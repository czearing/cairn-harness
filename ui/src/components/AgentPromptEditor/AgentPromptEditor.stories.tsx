import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AgentPromptEditor } from "./AgentPromptEditor";

const meta = { title: "Agents/AgentPromptEditor", component: AgentPromptEditor } satisfies Meta<typeof AgentPromptEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { agent: { id: "lead", role: "Project lead", prompt: "Plan and delegate.", status: "idle", updatedAt: "" }, onSave: async () => undefined, onClose: () => undefined } };
