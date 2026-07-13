import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActivityRow } from "./ActivityRow";

const meta = { component: ActivityRow, title: "Activity/ActivityRow", decorators: [(Story) => <div style={{ width: 420 }}><Story /></div>] } satisfies Meta<typeof ActivityRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Completed: Story = { args: { activity: { id: 1, agent: "writer", summary: "Completed the final story.", status: "completed", completedAt: new Date().toISOString(), chatId: "turn:1" } } };
export const Failed: Story = { args: { activity: { id: 2, agent: "composer", summary: "Turn timed out.", status: "failed", completedAt: new Date().toISOString(), chatId: "turn:2" } } };
