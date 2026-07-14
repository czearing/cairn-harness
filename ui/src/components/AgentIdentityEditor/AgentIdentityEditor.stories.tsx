import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AgentIdentityEditor } from "./AgentIdentityEditor";

const meta = { title: "Agents/AgentIdentityEditor", component: AgentIdentityEditor } satisfies Meta<typeof AgentIdentityEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { agent: { id: "writer", role: "Writer", status: "idle", updatedAt: "" }, color: "#8ab4f8", onColor: () => undefined, onAvatar: () => undefined } };
