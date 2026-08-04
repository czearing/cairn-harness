import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "../Button/Button";
import { Checkbox, FieldMessage, FormField, Input, Radio, RadioGroup, Select, Textarea } from "./FormField";

function FormGallery() {
  const [name, setName] = useState("Interface designer");
  const [model, setModel] = useState("gpt-5.5");
  return <div style={{ width: "min(560px, calc(100vw - 32px))", display: "grid", gap: 20, padding: 24, border: "1px solid #282c32", borderRadius: 14, background: "#111316" }}>
    <FormField label="Agent name" description="Shown throughout the project." required>
      <Input value={name} onChange={(event) => setName(event.target.value)} />
    </FormField>
    <FormField label="Instructions" description="Describe the outcome and operating boundaries." optional>
      <Textarea rows={4} placeholder="Write concise instructions…" />
    </FormField>
    <FormField label="Model">
      <Select value={model} onChange={(event) => setModel(event.target.value)}>
        <option value="gpt-5.5">GPT-5.5</option>
        <option value="gpt-5.4-mini">GPT-5.4 mini</option>
      </Select>
    </FormField>
    <Checkbox defaultChecked description="The agent can create new project work.">Enable idea generation</Checkbox>
    <RadioGroup legend="Model source" description="Choose how this agent resolves its model.">
      <Radio name="source" defaultChecked>Use global default</Radio>
      <Radio name="source">Use an agent override</Radio>
    </RadioGroup>
  </div>;
}

const meta = {
  title: "Forms/FormSystem",
  component: FormField,
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: { label: "Field", children: <Input /> },
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = { render: () => <FormGallery /> };
export const Error: Story = { args: { label: "Agent name", error: "Enter a unique agent name.", children: <Input defaultValue="lead" /> } };
export const Disabled: Story = { args: { label: "Unavailable model", description: "Model availability is still loading.", children: <Select disabled><option>Loading…</option></Select> } };
export const InlineColor: Story = { args: { label: "Identity color", layout: "inline", children: <Input variant="color" type="color" defaultValue="#9ef0c0" /> } };
export const FileUpload: Story = { args: { label: "Picture", optional: true, children: <Input variant="file" type="file" accept="image/*" /> } };
export const Feedback: Story = {
  render: () => <div style={{ width: 420, display: "grid", gap: 12 }}>
    <FieldMessage tone="status">Checking available models…</FieldMessage>
    <FieldMessage tone="success">All changes saved.</FieldMessage>
    <FieldMessage tone="warning" action={<Button variant="secondary" size="compact">Retry</Button>}>Models could not be checked.</FieldMessage>
    <FieldMessage tone="error">Project creation failed.</FieldMessage>
  </div>,
};
export const KeyboardFocus: Story = {
  args: { label: "Focused field", children: <Input /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("textbox", { name: "Focused field" })).toHaveFocus();
  },
};
