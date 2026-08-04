import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { ActiveWork } from "../ActiveWork/ActiveWork";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const agents = [
  { id: "lead", title: "Maya Chen", role: "Project lead", status: "working" as const, updatedAt: minutesAgo(1) },
  { id: "builder", title: "Interface Engineer", role: "Frontend implementation", status: "working" as const, updatedAt: minutesAgo(2) },
  { id: "reviewer", title: "Product Reviewer", role: "Quality and accessibility", status: "idle" as const, updatedAt: minutesAgo(7) },
];
const roots = [
  {
    id: "root-running",
    title: "Launch the redesigned operations workspace",
    content: "Launch the redesigned operations workspace across every supported viewport without clipping controls or losing task context.",
    meta: "",
    status: "claimed",
    accountableId: "lead",
    updatedAt: minutesAgo(1),
  },
  {
    id: "root-blocked",
    title: "Resolve production publishing",
    content: "Resolve the production publishing blocker while preserving the current release and rollback path.",
    meta: "",
    status: "blocked",
    accountableId: "lead",
    updatedAt: minutesAgo(18),
  },
  {
    id: "root-complete",
    title: "Establish the visual baseline",
    content: "Establish the visual baseline for the workspace.",
    meta: "",
    status: "completed",
    accountableId: "lead",
    updatedAt: minutesAgo(62),
  },
];
const delegated = [
  {
    id: "child-complete",
    title: "Responsive shell",
    content: "Implement the responsive workspace shell",
    meta: "",
    status: "completed",
    parentId: "root-running",
    executorId: "builder",
    updatedAt: minutesAgo(22),
  },
  {
    id: "child-running",
    title: "Interaction polish",
    content: "Polish focus, hover, loading, and transition behavior",
    meta: "",
    status: "claimed",
    parentId: "root-running",
    executorId: "builder",
    updatedAt: minutesAgo(2),
  },
  {
    id: "child-queued",
    title: "Accessibility review",
    content: "Review keyboard flow, contrast, and screen reader announcements",
    meta: "",
    status: "pending",
    parentId: "root-running",
    executorId: "reviewer",
    updatedAt: minutesAgo(7),
  },
  {
    id: "child-failed",
    title: "Publishing policy",
    content: "Confirm the production publishing policy",
    meta: "",
    status: "failed",
    parentId: "root-blocked",
    executorId: "reviewer",
    updatedAt: minutesAgo(18),
  },
];
const noop = () => undefined;
const noopAsync = async () => undefined;
const hiddenHeading = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

function StoryFrame({ children }: { children: ReactNode }) {
  return <main aria-label="Active work component preview" style={{ width: "min(1040px, calc(100vw - 40px))" }}>
    <h1 style={hiddenHeading}>Active work component</h1>
    {children}
  </main>;
}

const meta = {
  title: "Work/ActiveWork",
  component: ActiveWork,
  decorators: [(Story) => <StoryFrame><Story /></StoryFrame>],
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: {
    projectId: "storybook-project",
    agents,
    colors: { "storybook-project:lead": "#e9c46a", "storybook-project:builder": "#9ef0c0", "storybook-project:reviewer": "#8ab4f8" },
    avatars: {},
    roots,
    delegated,
    onRoot: noop,
    onRootCancel: noopAsync,
    onRootDelete: noopAsync,
    onChild: noop,
    onChildCancel: noopAsync,
    onChildDelete: noopAsync,
  },
} satisfies Meta<typeof ActiveWork>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DenseOwnersAndNestedWork: Story = {};
export const Empty: Story = { args: { roots: [], delegated: [] } };
export const Undelegated: Story = {
  args: {
    roots: [{ ...roots[0], id: "undelegated", content: "Plan and deliver the customer migration", status: "claimed" }],
    delegated: [],
  },
};
export const Mobile: Story = {
  decorators: [(Story) => <div style={{ width: 390 }}><Story /></div>],
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
