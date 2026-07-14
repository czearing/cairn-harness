import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MarkdownEditor } from "./MarkdownEditor";

const meta = { title: "Editors/MarkdownEditor", component: MarkdownEditor } satisfies Meta<typeof MarkdownEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { initialMarkdown: "## Reusable document\n\nEdit tasks, prompts, or notes.", onChange: () => undefined } };
