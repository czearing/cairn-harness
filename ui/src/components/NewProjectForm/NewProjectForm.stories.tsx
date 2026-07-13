import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NewProjectForm } from "./NewProjectForm";

const meta = { component: NewProjectForm, title: "Projects/NewProjectForm", decorators: [(Story) => <div style={{ width: 400 }}><Story /></div>] } satisfies Meta<typeof NewProjectForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { onCreate: async () => undefined } };
