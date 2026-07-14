import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DelegatedTodoRow } from "./DelegatedTodoRow";

const meta = { title: "Tasks/DelegatedTodoRow", component: DelegatedTodoRow } satisfies Meta<typeof DelegatedTodoRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Claimed: Story = { args: { item: { id: "1", title: "", content: "Develop the pan sauce and report its final seasoning.", meta: "", status: "claimed", context: "For Dinner recipe", agentId: "sauce-chef" } } };
