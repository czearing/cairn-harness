import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskEditor } from "./TaskEditor";

type PromiseMode = "resolved" | "rejected" | "deferred";

interface HarnessProps {
  initialMarkdown?: string;
  save?: PromiseMode;
  send?: PromiseMode;
  successMessage?: string;
}

function completion(mode: PromiseMode, message: string) {
  if (mode === "rejected") return Promise.reject(new Error(message));
  if (mode === "deferred") return new Promise<void>(() => undefined);
  return Promise.resolve();
}

function StoryHarness({ initialMarkdown = "", save = "resolved", send = "resolved", successMessage }: HarnessProps) {
  return <div style={{ height: "100vh", background: "var(--canvas)" }}>
    <TaskEditor
      initialMarkdown={initialMarkdown}
      onSave={async () => completion(save, "Draft not saved")}
      onSend={async () => completion(send, "Work not started")}
      successMessage={successMessage}
    />
  </div>;
}

const meta = {
  title: "Tasks/TaskEditor",
  component: StoryHarness,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof StoryHarness>;
export default meta;
type Story = StoryObj<typeof meta>;

const checklist = "## Launch checklist\n\n- [ ] Confirm mobile layout\n- [ ] Publish the release";

export const Draft: Story = { args: { initialMarkdown: checklist } };
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Start work" })).toBeDisabled();
  },
};
export const Submitting: Story = {
  args: { initialMarkdown: checklist, send: "deferred" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Start work" }));
    const busy = await canvas.findByRole("button", { name: "Starting work…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
  },
};
export const SaveFailure: Story = {
  args: { save: "rejected" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Draft document"));
    await userEvent.type(canvas.getByLabelText("Draft document"), "Recover the release");
    await waitFor(() => expect(canvas.getByText("Not saved")).toBeInTheDocument());
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeEnabled();
  },
};
export const SubmissionFailure: Story = {
  args: { initialMarkdown: checklist, send: "rejected" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(canvas.getByText("Work not started")).toBeInTheDocument());
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeEnabled();
  },
};
export const WorkStarted: Story = { args: { initialMarkdown: checklist, successMessage: "Task created" } };
export const KeyboardSubmit: Story = {
  args: { initialMarkdown: checklist, send: "deferred" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Draft document"));
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(await canvas.findByRole("button", { name: "Starting work…" })).toBeDisabled();
  },
};
export const LongContent: Story = {
  args: { initialMarkdown: `# ${"A very long draft title ".repeat(8)}\n\n${"Detailed planning content. ".repeat(80)}` },
};
export const Narrow390: Story = { args: { initialMarkdown: checklist }, parameters: { viewport: { defaultViewport: "mobile2" } } };
export const Mobile320: Story = { args: { initialMarkdown: checklist }, parameters: { viewport: { defaultViewport: "mobile1" } } };
export const ReducedMotion: Story = { args: { initialMarkdown: checklist, send: "deferred" }, parameters: { chromatic: { prefersReducedMotion: "reduce" } } };
