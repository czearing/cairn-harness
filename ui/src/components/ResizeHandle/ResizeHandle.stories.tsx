import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { ResizeHandle } from "./ResizeHandle";

function VerticalDemo() {
  const [width, setWidth] = useState(240);
  return <div style={{ minHeight: 420, display: "grid", gridTemplateColumns: `${width}px 24px minmax(0, 1fr)`, background: "#0b0c0e", color: "#f2f1ec" }}>
    <aside id="story-navigation" style={{ padding: 20, borderRight: "1px solid #282c32", background: "#0d0f11" }}>Navigation · {width}px</aside>
    <ResizeHandle orientation="vertical" label="Resize navigation" controls="story-navigation" value={width} min={180} max={360} defaultValue={240} onPreview={setWidth} onCommit={setWidth} onCancel={setWidth} />
    <main style={{ padding: 24 }}>Dashboard canvas</main>
  </div>;
}

function HorizontalDemo() {
  const [height, setHeight] = useState(280);
  return <div style={{ minHeight: 540, display: "grid", gridTemplateRows: `minmax(0, 1fr) 12px ${height}px`, background: "#0b0c0e", color: "#f2f1ec" }}>
    <main style={{ padding: 24 }}>Dashboard canvas</main>
    <ResizeHandle orientation="horizontal" direction={-1} label="Resize drafts" controls="story-drafts" value={height} min={220} max={420} defaultValue={280} onPreview={setHeight} onCommit={setHeight} onCancel={setHeight} />
    <section id="story-drafts" style={{ padding: 20, borderTop: "1px solid #282c32", background: "#0f1114" }}>Draft workspace · {height}px</section>
  </div>;
}

const meta = {
  title: "Dashboard/ResizeHandle",
  component: ResizeHandle,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: {
    orientation: "vertical",
    label: "Resize pane",
    controls: "story-pane",
    value: 240,
    min: 180,
    max: 360,
    defaultValue: 240,
    onPreview: () => undefined,
    onCommit: () => undefined,
    onCancel: () => undefined,
  },
} satisfies Meta<typeof ResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = { render: () => <VerticalDemo /> };
export const Horizontal: Story = { render: () => <HorizontalDemo /> };
export const KeyboardResize: Story = {
  render: () => <VerticalDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvas.getByRole("separator", { name: "Resize navigation" });
    await userEvent.click(handle);
    await userEvent.keyboard("{ArrowRight}");
    await expect(handle).toHaveAttribute("aria-valuenow", "248");
    await userEvent.keyboard("{Home}");
    await expect(handle).toHaveAttribute("aria-valuenow", "180");
    await userEvent.keyboard("{End}");
    await expect(handle).toHaveAttribute("aria-valuenow", "360");
  },
};
