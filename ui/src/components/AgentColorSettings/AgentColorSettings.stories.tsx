import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AgentColorSettings } from "./AgentColorSettings";

const meta = { component: AgentColorSettings, title: "Settings/AgentColorSettings", decorators: [(Story) => <div style={{ width: 360 }}><Story /></div>] } satisfies Meta<typeof AgentColorSettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { agents: [{ id: "writer", role: "Writer", status: "idle", updatedAt: "" }], colors: {}, onChange: () => undefined } };
