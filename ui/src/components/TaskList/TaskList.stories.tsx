import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskList } from "./TaskList";

const meta = { title: "Tasks/TaskList", component: TaskList } satisfies Meta<typeof TaskList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: {
  drafts: [{ id: "d", title: "Draft launch plan", meta: "", status: "draft" }],
  tasks: [{ id: "a", title: "Build launch", meta: "", status: "in-progress" }, { id: "b", title: "Research", meta: "", status: "done" }],
  onOpen: () => undefined,
} };
