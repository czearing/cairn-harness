import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { MessageComposer } from "./MessageComposer";

const meta = {
  component: MessageComposer,
  title: "Actions/MessageComposer",
  decorators: [(Story) => <main style={{ width: "min(560px, calc(100vw - 32px))" }}><Story /></main>],
  args: { projectId: "restaurant", agent: "Head chef", onSend: fn() },
} satisfies Meta<typeof MessageComposer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Draft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const message = canvas.getByRole("textbox", { name: "Message Head chef" });
    await userEvent.type(message, "Summarize the menu risks before service.");
    await expect(message).toHaveFocus();
    await expect(canvas.getByRole("button", { name: "Send message" })).toBeEnabled();
  },
};

export const Multiline: Story = {
  play: async ({ canvasElement }) => {
    const message = within(canvasElement).getByRole("textbox", { name: "Message Head chef" });
    await userEvent.type(message, "Confirm the prep sequence.{enter}Call out anything blocked.{enter}Keep the answer concise.");
    await expect(message).toHaveValue("Confirm the prep sequence.\nCall out anything blocked.\nKeep the answer concise.");
  },
};

export const SendsTrimmedMessage: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Message Head chef" }), "  Check tonight's service plan.  ");
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));
    await expect(args.onSend).toHaveBeenCalledWith(
      "Check tonight's service plan.",
      expect.stringMatching(/^restaurant:/),
    );
  },
};

export const KeyboardSend: Story = {
  play: async ({ args, canvasElement }) => {
    const message = within(canvasElement).getByRole("textbox", { name: "Message Head chef" });
    await userEvent.type(message, "Send from the keyboard.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(args.onSend).toHaveBeenCalledWith(
      "Send from the keyboard.",
      expect.stringMatching(/^restaurant:/),
    );
  },
};

export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 288 }}><Story /></div>],
};

export const InConversation: Story = {
  decorators: [(Story) => <section style={{
    display: "grid",
    gap: 16,
    width: "min(560px, calc(100vw - 32px))",
    padding: 20,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--surface-1)",
  }}>
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ justifySelf: "start", maxWidth: "78%", padding: "9px 12px", borderRadius: 16, background: "var(--surface-2)" }}>I found two deployment risks.</div>
      <div style={{ justifySelf: "end", maxWidth: "78%", padding: "9px 12px", borderRadius: 16, background: "var(--accent-soft)" }}>Send the concise version.</div>
    </div>
    <Story />
  </section>],
};
