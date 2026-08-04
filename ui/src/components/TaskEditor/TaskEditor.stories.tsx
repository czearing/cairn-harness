import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskEditor } from "./TaskEditor";

const meta = { title: "Tasks/TaskEditor", component: TaskEditor, parameters: { layout: "fullscreen" } } satisfies Meta<typeof TaskEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Draft: Story = { args: { initialMarkdown: "## Launch checklist\n\n- [ ] Confirm mobile layout\n- [ ] Publish the release", onSave: async () => undefined, onSend: async () => undefined } };
