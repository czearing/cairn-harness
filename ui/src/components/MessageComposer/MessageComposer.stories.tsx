import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageComposer } from "./MessageComposer";

const meta = { component: MessageComposer, title: "Actions/MessageComposer", decorators: [(Story) => <div style={{ width: 380 }}><Story /></div>] } satisfies Meta<typeof MessageComposer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { agent: "head-chef", onSend: async () => undefined } };
