import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import type { QueueItem } from "@/lib/types";
import { DraftWorkspace, emptyDraftButtonId, type DraftTab, type DraftWorkspaceState } from "./DraftWorkspaceView";

type PromiseMode = "resolved" | "rejected" | "deferred";

interface HarnessProps {
  tabs?: DraftTab[];
  save?: PromiseMode;
  send?: PromiseMode;
  discard?: PromiseMode;
  successDraftId?: string;
}

function draft(id: string, content = "", persisted = true): DraftTab {
  const item: QueueItem = { id, title: "Draft", meta: "", status: "draft", content };
  return { item, persisted };
}

function completion(mode: PromiseMode, message: string) {
  if (mode === "rejected") return Promise.reject(new Error(message));
  if (mode === "deferred") return new Promise<void>(() => undefined);
  return Promise.resolve();
}

function StoryHarness({
  tabs = [draft("draft-1", "", false)],
  save = "resolved",
  send = "resolved",
  discard = "resolved",
  successDraftId,
}: HarnessProps) {
  const [workspace, setWorkspace] = useState<DraftWorkspaceState>({ tabs, activeId: tabs[0]?.item.id });
  function close(draftId: string) {
    setWorkspace((current) => {
      const index = current.tabs.findIndex((tab) => tab.item.id === draftId);
      const nextTabs = current.tabs.filter((tab) => tab.item.id !== draftId);
      const activeId = nextTabs[index]?.item.id || nextTabs[index - 1]?.item.id;
      requestAnimationFrame(() => {
        if (!activeId) document.getElementById(emptyDraftButtonId("storybook-project"))?.focus();
      });
      return {
        tabs: nextTabs,
        activeId,
      };
    });
  }
  return <div style={{ minHeight: "100vh", background: "#090a0b" }}>
    <DraftWorkspace
      projectId="storybook-project"
      workspace={workspace}
      onActive={(activeId) => setWorkspace((current) => ({ ...current, activeId }))}
      onReorder={(sourceId, targetId) => setWorkspace((current) => {
        const tabs = [...current.tabs];
        const source = tabs.findIndex((tab) => tab.item.id === sourceId);
        const target = tabs.findIndex((tab) => tab.item.id === targetId);
        if (source < 0 || target < 0) return current;
        const [moved] = tabs.splice(source, 1);
        tabs.splice(target, 0, moved);
        return { ...current, tabs };
      })}
      onHeight={(height) => setWorkspace((current) => ({ ...current, height }))}
      onClose={async (_projectId, draftId) => {
        await completion(save, "Draft not saved");
        close(draftId);
        return true;
      }}
      onAbandon={(_projectId, draftId) => close(draftId)}
      onDiscard={async (_projectId, draftId) => {
        try {
          await completion(discard, "Draft not discarded");
          close(draftId);
          return true;
        } catch {
          return false;
        }
      }}
      onRegister={() => undefined}
      onSave={async (_projectId, draftId, body) => {
        await completion(save, "Draft not saved");
        setWorkspace((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => tab.item.id === draftId
            ? { ...tab, persisted: true, item: { ...tab.item, content: body } }
            : tab),
        }));
      }}
      onChange={(_projectId, draftId, body) => setWorkspace((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => tab.item.id === draftId
          ? { ...tab, item: { ...tab.item, content: body } }
          : tab),
      }))}
      onSend={async () => completion(send, "Work not started")}
      onNew={() => {
        const item = draft(`draft-${workspace.tabs.length + 1}`, "", false);
        setWorkspace((current) => ({ tabs: [...current.tabs, item], activeId: item.item.id }));
      }}
      successDraftId={successDraftId}
      onPointerFocus={() => undefined}
    />
  </div>;
}

const meta = {
  title: "Tasks/DraftWorkspace",
  component: StoryHarness,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof StoryHarness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PristineBlank: Story = {};
export const Empty: Story = { args: { tabs: [] } };
export const OneSavedDraft: Story = { args: { tabs: [draft("saved", "# Release plan\n\nConfirm the rollout sequence.")] } };
export const ManyDraftsOverflow: Story = { args: { tabs: Array.from({ length: 12 }, (_, index) => draft(`draft-${index}`, `# Draft ${index + 1}`)) } };
export const FinalCloseRestoresFocus: Story = {
  args: { tabs: [draft("only", "", false)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Close draft: Untitled"));
    await expect(canvas.getByRole("button", { name: "New draft" })).toHaveFocus();
  },
};
export const DirtyUnsaved: Story = {
  args: { tabs: [draft("unsaved", "", false)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Draft document"));
    await userEvent.type(canvas.getByLabelText("Draft document"), "A new draft");
    await expect(canvas.getByRole("button", { name: "Start work" })).toBeEnabled();
  },
};
export const DirtySaved: Story = { args: { tabs: [draft("saved", "# Existing draft")] } };
export const Saving: Story = { args: { save: "deferred" } };
export const SaveFailure: Story = { args: { save: "rejected" } };
export const CloseUnsavedDialog: Story = {
  args: { tabs: [draft("unsaved", "Unsaved text", false)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Draft document"), " changed");
    await userEvent.click(canvas.getByLabelText("Close draft: Unsaved text changed"));
    await expect(within(document.body).getByRole("alertdialog", { name: "Close unsaved draft?" })).toBeInTheDocument();
  },
};
export const CloseSavedDraft: Story = {
  args: { tabs: [draft("saved", "# Saved draft")] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Close draft: Saved draft"));
    await expect(canvas.getByRole("tab")).not.toBeInTheDocument();
  },
};
export const CloseSavedFailure: Story = {
  args: { tabs: [draft("saved", "# Saved draft")], discard: "rejected" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("Close draft: Saved draft"));
    await expect(within(document.body).getByRole("dialog", { name: "Draft not closed" })).toBeInTheDocument();
  },
};
export const SubmissionFailure: Story = { args: { send: "rejected" } };
export const WorkStartedSuccess: Story = { args: { tabs: [draft("success", "# Ready")], successDraftId: "success" } };
export const LongTitleAndContent: Story = { args: { tabs: [draft("long", `# ${"A very long draft title ".repeat(8)}\n\n${"Detailed planning content. ".repeat(80)}`)] } };
export const Narrow390: Story = { parameters: { viewport: { defaultViewport: "mobile2" } } };
export const Mobile320: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };
export const Short960x426: Story = { parameters: { viewport: { defaultViewport: "responsive" } } };
export const ExtremeShort800x320: Story = { parameters: { viewport: { defaultViewport: "responsive" } } };
export const ExtremeShort320x180: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" }, chromatic: { viewports: [320], pauseAnimationAtEnd: true } },
};
export const KeyboardFocusVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("separator", { name: "Resize draft workbench" })).toHaveFocus();
  },
};
export const ReducedMotion: Story = { parameters: { chromatic: { prefersReducedMotion: "reduce" } } };
export const AccessibilityErrors: Story = { parameters: { a11y: { test: "todo" } } };
