import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IdentityEditor } from "./AgentIdentityEditor";

const meta = { title: "Identity/IdentityEditor", component: IdentityEditor } satisfies Meta<typeof IdentityEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { name: "writer", color: "#8ab4f8", onColor: () => undefined, onAvatar: () => undefined } };
