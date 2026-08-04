import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActivityRow } from "./ActivityRow";

const meta = { component: ActivityRow, title: "Activity/ActivityRow", decorators: [(Story) => <div style={{ width: 420 }}><Story /></div>] } satisfies Meta<typeof ActivityRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Completed: Story = { args: { activity: { id: 1, agent: "writer", summary: "Completed the final story.", status: "completed", completedAt: new Date().toISOString(), chatId: "turn:1" }, agentLabel: "Story writer", agentRemoved: false } };
export const Delegated: Story = { args: { activity: { id: 2, agent: "lead", summary: "Delegated: Implement dashboard fallback", status: "waiting", completedAt: new Date().toISOString(), chatId: "turn:2" }, agentRemoved: false } };
export const Failed: Story = { args: { activity: { id: 3, agent: "composer", summary: "Turn timed out.", status: "failed", completedAt: new Date().toISOString(), chatId: "turn:3" }, agentRemoved: false } };
export const RemovedAgent: Story = { args: { activity: { id: 4, agent: "researcher", summary: "Archived the findings.", status: "completed", completedAt: new Date().toISOString(), chatId: "turn:4" }, agentRemoved: true } };
export const MultipleTasks: Story = { args: { activity: { id: 5, agent: "lead", summary: "Delegated: Refine dashboard hierarchy; verify mobile geometry; run accessibility review", status: "waiting", completedAt: new Date().toISOString(), chatId: "turn:5" }, agentRemoved: false } };
