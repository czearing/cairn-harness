import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState, type ComponentProps } from "react";
import { MarkdownEditor } from "./MarkdownEditor";

const meta = {
  title: "Editors/MarkdownEditor",
  component: MarkdownEditor,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ boxSizing: "border-box", width: "100%", maxWidth: 920, margin: "0 auto", padding: 16 }}>
    <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Markdown editor</h1>
    <Story />
  </main>],
} satisfies Meta<typeof MarkdownEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { initialMarkdown: "## Reusable document\n\nEdit tasks, prompts, or notes.", onChange: () => undefined } };
export const Readability: Story = {
  args: {
    initialMarkdown: `# Professional writing surface

Body text should remain comfortable during long editing sessions. The measure, contrast, spacing, and hierarchy should make each instruction easy to scan without turning the editor into a dense settings panel.

## Implementation guidance

- Keep the writing column focused and readable.
- Preserve clear hierarchy between sections and supporting text.
- Make every formatting state reversible.

> Good editor design keeps attention on the document instead of the interface.

Use \`inline code\` for commands and identifiers.`,
    onChange: () => undefined,
    label: "Readability editor",
  },
  play: async ({ canvasElement }) => {
    const editor = within(canvasElement).getByRole("textbox", { name: "Readability editor" });
    const style = getComputedStyle(editor);
    await expect(Number.parseFloat(style.fontSize)).toBeGreaterThanOrEqual(16);
    await expect(Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize)).toBeGreaterThanOrEqual(1.5);
    await expect(style.fontFamily).not.toContain("Times New Roman");
    await expect(editor.getBoundingClientRect().width).toBeLessThanOrEqual(760);
  },
};
export const ListRecovery: Story = {
  args: {
    initialMarkdown: "- First instruction\n- Second instruction\n\n## Heading\n\nBody text",
    onChange: () => undefined,
    label: "List recovery editor",
  },
  render: (args) => <StoryHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByText("First instruction");
    await userEvent.click(firstItem);
    await userEvent.click(canvas.getByRole("button", { name: "Text style" }));
    await userEvent.click(canvas.getByRole("menuitemradio", { name: "Body text" }));
    await expect(firstItem.closest("li")).toBeNull();
    await expect(firstItem.closest("p")).toBeInTheDocument();
    const serialized = canvasElement.querySelector("[data-serialized-markdown]")?.getAttribute("data-serialized-markdown");
    await expect(serialized).not.toContain("- First instruction");
  },
};

function StoryHarness(props: ComponentProps<typeof MarkdownEditor>) {
  const [markdown, setMarkdown] = useState(props.initialMarkdown);
  return <div data-serialized-markdown={markdown}>
    <MarkdownEditor {...props} onChange={(value) => {
      setMarkdown(value);
      props.onChange(value);
    }} />
  </div>;
}
