import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DelegatedActionRow } from "./DelegatedActionRow";

const meta = { title: "Tasks/DelegatedActionRow", component: DelegatedActionRow } satisfies Meta<typeof DelegatedActionRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Claimed: Story = { args: { item: { id: "1", title: "", content: "Develop the pan sauce and report its final seasoning.", meta: "", status: "claimed", context: "For Dinner recipe", agentId: "sauce-chef" } } };
