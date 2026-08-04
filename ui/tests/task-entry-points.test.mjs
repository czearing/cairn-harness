import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../src/components/", import.meta.url);

test("project overview exposes one primary task entry point", async () => {
  const [header, activeWork, workMap, dashboardStyles] = await Promise.all([
    readFile(new URL("ProjectHeader/ProjectHeader.tsx", root), "utf8"),
    readFile(new URL("ActiveWork/ActiveWork.tsx", root), "utf8"),
    readFile(new URL("WorkMap/WorkMap.tsx", root), "utf8"),
    readFile(new URL("Dashboard/Dashboard.module.css", root), "utf8"),
  ]);

  assert.match(header, />New task<\/Button>/);
  assert.doesNotMatch(activeWork, /New task/);
  assert.doesNotMatch(workMap, /Open task drafts/);
  assert.match(dashboardStyles, /\.draftWorkspace\[data-empty="true"\] \{ display: none; \}/);
});
