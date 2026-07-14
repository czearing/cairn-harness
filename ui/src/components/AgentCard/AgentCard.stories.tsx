import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AgentCard } from "./AgentCard";

const meta = { component: AgentCard, title: "Agents/AgentCard", parameters: { layout: "padded" } } satisfies Meta<typeof AgentCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Working: Story = { args: { agent: { id: "head-chef", role: "Menu director", status: "working", topic: "menu direction", updatedAt: "", lastMessage: "The menu direction is ready.", lastMessageAt: new Date().toISOString() }, onClick: () => undefined } };
export const Idle: Story = { args: { agent: { id: "pastry-chef", role: "Pastry specialist", status: "idle", updatedAt: "" } } };
