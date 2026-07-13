import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WorkItemForm } from "./WorkItemForm";

const meta = { component: WorkItemForm, title: "Actions/WorkItemForm", decorators: [(Story) => <div style={{ width: 380 }}><Story /></div>] } satisfies Meta<typeof WorkItemForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { onCreate: async () => undefined } };
