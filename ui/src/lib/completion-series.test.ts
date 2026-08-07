import assert from "node:assert/strict";
import { test } from "node:test";
import { completionSeries, dayKey } from "./completion-series.ts";

const event = (agentId: string, completedAt: string) => ({ agentId, completedAt });

test("an empty history produces an empty series rather than a degenerate axis", () => {
  const series = completionSeries([], "UTC");
  assert.deepEqual(series, { days: [], agents: [], total: 0 });
});

test("every timestamp shape the runtimes emit lands on the same day", () => {
  const shapes = [
    "2026-08-05T12:00:00Z",
    "2026-08-05T12:00:00.000Z",
    "2026-08-05T12:00:00+00:00",
    "2026-08-05T12:00:00.335615300+00:00",
  ];
  for (const shape of shapes) assert.equal(dayKey(shape, "UTC"), "2026-08-05", shape);
});

test("a completion is bucketed by the viewer's day, not by the UTC date", () => {
  // 02:30 UTC on the 6th is still the evening of the 5th in New York. Slicing the UTC string would file
  // this completion under a day the operator had already gone home.
  assert.equal(dayKey("2026-08-06T02:30:00Z", "America/New_York"), "2026-08-05");
  assert.equal(dayKey("2026-08-06T02:30:00Z", "UTC"), "2026-08-06");
});

test("unparseable and unattributed rows are dropped instead of poisoning the axis", () => {
  const series = completionSeries([
    event("a", "not a date"),
    event("", "2026-08-05T12:00:00Z"),
    event("a", "2026-08-05T12:00:00Z"),
  ], "UTC");
  assert.deepEqual(series.days, ["2026-08-05"]);
  assert.equal(series.total, 1);
});

test("days with no completions are carried forward so the line never implies invented work", () => {
  const series = completionSeries([
    event("a", "2026-08-01T12:00:00Z"),
    event("a", "2026-08-04T12:00:00Z"),
  ], "UTC");
  assert.deepEqual(series.days, ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]);
  assert.deepEqual(series.agents[0].points.map((point) => point.total), [1, 1, 1, 2]);
});

test("each agent spans the full range even when it started late or stopped early", () => {
  const series = completionSeries([
    event("early", "2026-08-01T12:00:00Z"),
    event("late", "2026-08-03T12:00:00Z"),
  ], "UTC");
  const byId = new Map(series.agents.map((agent) => [agent.agentId, agent]));
  assert.deepEqual(byId.get("early")?.points.map((point) => point.total), [1, 1, 1]);
  assert.deepEqual(byId.get("late")?.points.map((point) => point.total), [0, 0, 1]);
});

test("cumulative totals are monotonic and end at the agent total", () => {
  const series = completionSeries([
    event("a", "2026-08-01T01:00:00Z"),
    event("a", "2026-08-01T02:00:00Z"),
    event("a", "2026-08-03T02:00:00Z"),
  ], "UTC");
  const totals = series.agents[0].points.map((point) => point.total);
  assert.deepEqual(totals, [2, 2, 3]);
  assert.equal(series.agents[0].total, 3);
  for (let index = 1; index < totals.length; index += 1) assert.ok(totals[index] >= totals[index - 1]);
});

test("agents are ranked by contribution, ties broken by name so the order is stable", () => {
  const series = completionSeries([
    event("zoe", "2026-08-01T01:00:00Z"),
    event("amy", "2026-08-01T01:00:00Z"),
    event("max", "2026-08-01T01:00:00Z"),
    event("max", "2026-08-01T02:00:00Z"),
  ], "UTC");
  assert.deepEqual(series.agents.map((agent) => agent.agentId), ["max", "amy", "zoe"]);
  assert.equal(series.total, 4);
});

test("a month boundary advances the day cursor instead of stalling", () => {
  const series = completionSeries([
    event("a", "2026-07-30T12:00:00Z"),
    event("a", "2026-08-02T12:00:00Z"),
  ], "UTC");
  assert.deepEqual(series.days, ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
});

test("a leap day is a real day in the range", () => {
  const series = completionSeries([
    event("a", "2028-02-28T12:00:00Z"),
    event("a", "2028-03-01T12:00:00Z"),
  ], "UTC");
  assert.deepEqual(series.days, ["2028-02-28", "2028-02-29", "2028-03-01"]);
});

test("a single completion yields one day rather than an empty or infinite range", () => {
  const series = completionSeries([event("a", "2026-08-05T12:00:00Z")], "UTC");
  assert.deepEqual(series.days, ["2026-08-05"]);
  assert.deepEqual(series.agents[0].points, [{ day: "2026-08-05", total: 1 }]);
});

test("a long history stays bounded and correct", () => {
  const events = Array.from({ length: 2000 }, (_, index) =>
    event(`agent-${index % 5}`, new Date(Date.UTC(2026, 0, 1 + (index % 365), 12)).toISOString()));
  const series = completionSeries(events, "UTC");
  assert.equal(series.days.length, 365);
  assert.equal(series.total, 2000);
  assert.equal(series.agents.reduce((sum, agent) => sum + agent.total, 0), 2000);
  for (const agent of series.agents) assert.equal(agent.points.length, 365);
});
