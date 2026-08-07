import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/Dashboard/Dashboard.tsx");
const drafts = read("../src/components/Dashboard/DraftWorkspaceView.tsx");
const sidebar = read("../src/components/ProjectSidebar/ProjectSidebar.tsx");
const activity = read("../src/components/ActivityRail/ActivityRail.tsx");
const resizeHandle = read("../src/components/ResizeHandle/ResizeHandle.tsx");
const paneStories = read("../src/components/DashboardPane/DashboardPane.stories.tsx");
const resizeStories = read("../src/components/ResizeHandle/ResizeHandle.stories.tsx");
const sidebarStories = read("../src/components/ProjectSidebar/ProjectSidebar.stories.tsx");

test("dashboard surfaces share one pane foundation", () => {
  assert.match(sidebar, /<DashboardPane/);
  assert.match(sidebar, /DashboardPaneHeader/);
  assert.match(sidebar, /DashboardPaneBody/);
  assert.match(sidebar, /DashboardPaneFooter/);
  assert.match(activity, /<DashboardPane/);
  assert.match(activity, /DashboardPaneHeader/);
  assert.match(drafts, /<DashboardPane/);
});

test("rails and drafts share one orientation-aware resize handle", () => {
  assert.equal((dashboard.match(/<ResizeHandle/g) || []).length, 2);
  assert.match(drafts, /<ResizeHandle/);
  assert.match(resizeHandle, /orientation: "horizontal" \| "vertical"/);
  assert.match(resizeHandle, /role="separator"/);
  assert.match(resizeHandle, /aria-controls=\{controls\}/);
  assert.match(resizeHandle, /aria-valuemin/);
  assert.match(resizeHandle, /aria-valuemax/);
  assert.match(resizeHandle, /aria-valuenow/);
  assert.match(resizeHandle, /setPointerCapture/);
  assert.match(resizeHandle, /event\.key === "Escape"/);
  assert.doesNotMatch(dashboard, /DashboardRailSplitter/);
  assert.doesNotMatch(drafts, /startY|startHeight/);
});

test("pane primitives and sidebar states are isolated in Storybook", () => {
  assert.match(paneStories, /Navigation/);
  assert.match(paneStories, /UtilityRail/);
  assert.match(resizeStories, /Vertical/);
  assert.match(resizeStories, /Horizontal/);
  assert.match(resizeStories, /KeyboardResize/);
  assert.match(sidebarStories, /Narrow180/);
  assert.match(sidebarStories, /Wide360/);
  assert.match(sidebarStories, /LongProjectNames/);
  assert.match(sidebarStories, /SelectionInteraction/);
});

const navItem = read("../src/components/ProjectNavItem/ProjectNavItem.tsx");
const navItemStyles = read("../src/components/ProjectNavItem/ProjectNavItem.module.css");
const sidebarStyles = read("../src/components/ProjectSidebar/ProjectSidebar.module.css");
const contextMenu = read("../src/components/ProjectContextMenu/ProjectContextMenu.tsx");
const pane = read("../src/components/DashboardPane/DashboardPane.tsx");

test("sidebar controls come from the shared control primitives", () => {
  assert.match(sidebar, /DashboardPaneSectionLabel/);
  assert.match(pane, /export function DashboardPaneSectionLabel/);
  for (const source of [sidebar, navItem]) assert.match(source, /IconButton/);
  assert.doesNotMatch(sidebarStyles, /\.label\b/);
  assert.doesNotMatch(sidebarStyles, /\.settings\b/);
  assert.doesNotMatch(navItemStyles, /\.menuTrigger \{[^}]*cursor: pointer/);
});

test("project identity marks come from one shared component", () => {
  for (const source of [sidebar, navItem, contextMenu]) assert.match(source, /<IdentityMark/);
  for (const source of [sidebar, navItem, contextMenu]) assert.doesNotMatch(source, /backgroundImage/);
  assert.doesNotMatch(navItemStyles, /\.mark \{[^}]*width: 24px/);
});

test("sidebar rows receive identity-addressed callbacks instead of per-row closures", () => {
  assert.match(navItem, /onClick: \(projectId: string\) => void/);
  assert.match(navItem, /onMenu: \(projectId: string, event: MouseEvent<HTMLButtonElement>\) => void/);
  assert.doesNotMatch(sidebar, /onClick=\{\(\) =>/);
  assert.doesNotMatch(sidebar, /onMenu=\{\(event\) =>/);
  assert.match(sidebar, /import \{ projectActivity \} from "@\/lib\/project-activity"/);
  assert.doesNotMatch(sidebar, /\.map\(\(project\) => <ProjectNavItem/);
  for (const source of [sidebar, navItem]) {
    assert.doesNotMatch(source, /\buseMemo\b|\buseCallback\b|\bmemo\(/);
  }
});

test("the row status is derived once in a tested module, never hand-rolled in the view", () => {
  // The always-green defect came from the view inventing its own status expression from a counter that
  // could not represent the activity it claimed to summarise.
  assert.doesNotMatch(navItem, /inProgress/);
  assert.doesNotMatch(navItem, /status=\{[^}]*\?/);
  assert.doesNotMatch(sidebar, /activeWorkCount/);
  assert.match(navItem, /status: ProjectActivity\["status"\]/);
});

test("in-progress rows animate on the compositor", () => {
  assert.match(navItemStyles, /@keyframes progress \{ to \{ transform: translate3d/);
  assert.doesNotMatch(navItemStyles, /background-position: -220%/);
});

test("new sidebar primitives are isolated in Storybook", () => {
  const iconButtonStories = read("../src/components/IconButton/IconButton.stories.tsx");
  const identityStories = read("../src/components/IdentityMark/IdentityMark.stories.tsx");
  assert.match(iconButtonStories, /SizeMatrix/);
  assert.match(identityStories, /Matrix/);
  assert.match(sidebarStories, /ManyProjects/);
  assert.match(sidebarStories, /ContextMenuOpen/);
  assert.match(sidebarStories, /KeyboardFocusOrder/);
  assert.match(sidebarStories, /EmptyState/);
});
