import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Panel } from "./Panel";

const meta = { component: Panel, title: "Layout/Panel", decorators: [(Story) => <div style={{ width: 420 }}><Story /></div>] } satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { title: "Tasks", children: <div style={{ padding: 12 }}>Panel content</div> } };
