import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueueRow } from "./QueueRow";

const meta = { component: QueueRow, title: "Work/QueueRow", decorators: [(Story) => <div style={{ width: 480 }}><Story /></div>] } satisfies Meta<typeof QueueRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WorkItem: Story = { args: { item: { id: "1", title: "Create song one", meta: "work-items/in-progress", status: "in progress" } } };
