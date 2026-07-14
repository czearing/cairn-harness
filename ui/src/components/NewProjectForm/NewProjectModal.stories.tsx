import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Modal } from "../Modal/Modal";
import { NewProjectForm } from "./NewProjectForm";

function Experience() {
  return <Modal title="New project" open onClose={() => undefined}>
    <NewProjectForm workspaceRoot="C:\\Users\\caleb\\Cairn Workspaces" onBrowse={async () => "C:\\Users\\caleb\\Projects"} onCreate={async () => undefined} />
  </Modal>;
}

const meta = { component: Experience, title: "Projects/NewProjectModal", parameters: { layout: "fullscreen" } } satisfies Meta<typeof Experience>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FirstRun: Story = {};
