import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const rail = read("../src/components/ActivityRail/ActivityRail.tsx");
const feed = read("../src/components/ActivityFeed/ActivityFeed.tsx");
const row = read("../src/components/ActivityRow/ActivityRow.tsx");
const presentation = read("../src/lib/activity-feed.ts");
const stories = read("../src/components/ActivityFeed/ActivityFeed.stories.tsx");

test("recent activity delegates presentation to one feed abstraction", () => {
  assert.match(rail, /<ActivityFeed/);
  assert.doesNotMatch(rail, /<ActivityRow/);
  assert.doesNotMatch(feed, /RoutineCompletions|Accordion|routineDefaultOpen/);
  assert.doesNotMatch(row, /StatusIndicator|activityStatusPresentation|display="dot"/);
});

test("routine completion noise is removed and meaningful updates are newest first", () => {
  assert.match(presentation, /isRoutineCompletion/);
  assert.match(presentation, /deliverable\|work/);
  assert.match(presentation, /\.filter\(\(item\) => !isRoutineCompletion\(item\)\)/);
  assert.match(presentation, /\.toSorted/);
  assert.match(presentation, /split\(\/\\s\*;\\s\*\/\)/);
  assert.match(presentation, /additional: Math\.max/);
});

test("activity feed states are isolated in Storybook", () => {
  for (const story of ["Mixed", "Empty", "GenericOnly", "Narrow220", "MinimalNewestFirst"]) {
    assert.match(stories, new RegExp(`export const ${story}`));
  }
});
