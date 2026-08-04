import assert from "node:assert/strict";
import test from "node:test";
import {
  moveDraftTab,
  resetSoleSubmittedDraft,
  updateDraftContentSnapshot,
} from "../src/components/Dashboard/draft-workspace-order.ts";

const tabs = ["first", "second", "third"].map((id) => ({ item: { id } }));

test("draft tabs move to the dropped tab position", () => {
  assert.deepEqual(
    moveDraftTab(tabs, "first", "third").map((tab) => tab.item.id),
    ["second", "third", "first"],
  );
  assert.deepEqual(
    moveDraftTab(tabs, "third", "first").map((tab) => tab.item.id),
    ["third", "first", "second"],
  );
});

test("invalid draft tab moves preserve the existing array", () => {
  assert.equal(moveDraftTab(tabs, "missing", "first"), tabs);
  assert.equal(moveDraftTab(tabs, "first", "first"), tabs);
});

test("submitting the sole draft replaces it with a fresh identity", () => {
  const workspace = {
    tabs: [{ item: { id: "draft-1", content: "Create the task" }, persisted: true }],
    activeId: "draft-1",
  };
  const replacement = { id: "draft-2", content: "" };
  assert.deepEqual(resetSoleSubmittedDraft(workspace, "draft-1", replacement), {
    tabs: [{ item: replacement, persisted: false }],
    activeId: "draft-2",
  });
  assert.equal(resetSoleSubmittedDraft({ ...workspace, tabs: [...workspace.tabs, { item: { id: "draft-2" }, persisted: false }] }, "draft-1", replacement), undefined);
  assert.equal(resetSoleSubmittedDraft(workspace, "missing", replacement), undefined);
});

test("draft content snapshots update without mutating rendered state", () => {
  const workspace = {
    tabs: [{ item: { id: "draft-1", content: "" }, persisted: false }],
    activeId: "draft-1",
  };
  const snapshot = updateDraftContentSnapshot(workspace, "draft-1", "Latest editor content");

  assert.notEqual(snapshot, workspace);
  assert.equal(snapshot.tabs[0].item.content, "Latest editor content");
  assert.equal(workspace.tabs[0].item.content, "");
  assert.equal(updateDraftContentSnapshot(workspace, "missing", "Ignored"), workspace);
});
