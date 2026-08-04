export function moveDraftTab<T extends { item: { id: string } }>(
  tabs: T[],
  sourceId: string,
  targetId: string,
) {
  const source = tabs.findIndex((tab) => tab.item.id === sourceId);
  const target = tabs.findIndex((tab) => tab.item.id === targetId);
  if (source < 0 || target < 0 || source === target) return tabs;
  const reordered = [...tabs];
  const [moved] = reordered.splice(source, 1);
  reordered.splice(target, 0, moved);
  return reordered;
}

export function updateDraftContentSnapshot<T extends { item: { id: string; content?: string } }>(
  workspace: { tabs: T[]; activeId?: string; height?: number },
  draftId: string,
  content: string,
) {
  const index = workspace.tabs.findIndex((tab) => tab.item.id === draftId);
  if (index < 0) return workspace;
  const tabs = [...workspace.tabs];
  const tab = tabs[index];
  tabs[index] = { ...tab, item: { ...tab.item, content } };
  return { ...workspace, tabs };
}

export function resetSoleSubmittedDraft<T extends { item: { id: string; content?: string }; persisted: boolean }>(
  workspace: { tabs: T[]; activeId?: string },
  draftId: string,
  replacement: T["item"],
) {
  const tab = workspace.tabs.length === 1 ? workspace.tabs[0] : undefined;
  if (!tab || tab.item.id !== draftId) return undefined;
  return {
    tabs: [{
      ...tab,
      item: replacement,
      persisted: false,
    }],
    activeId: replacement.id,
  };
}
