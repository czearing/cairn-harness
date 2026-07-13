import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DocumentPanel } from "./DocumentPanel";

const meta = { component: DocumentPanel, title: "Work/DocumentPanel", decorators: [(Story) => <div style={{ width: 420 }}><Story /></div>] } satisfies Meta<typeof DocumentPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Todo: Story = { args: { item: { id: "1", title: "lyrics.todo", meta: "todos/lyrics.todo", status: "delegated", content: "to: lyricist\n\nWrite song one." } } };
