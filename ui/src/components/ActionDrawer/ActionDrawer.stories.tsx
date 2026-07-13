import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActionDrawer } from "./ActionDrawer";

const meta = { component: ActionDrawer, title: "Layout/ActionDrawer", parameters: { layout: "fullscreen" } } satisfies Meta<typeof ActionDrawer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Open: Story = { args: { title: "New work item", open: true, onClose: () => undefined, children: <p>Focused action content.</p> } };
