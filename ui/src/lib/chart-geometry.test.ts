import assert from "node:assert/strict";
import { test } from "node:test";
import { chartGeometry, niceMaximum } from "./chart-geometry.ts";
import { completionSeries } from "./completion-series.ts";

const seriesOf = (events: [string, string][]) =>
  completionSeries(events.map(([agentId, completedAt]) => ({ agentId, completedAt })), "UTC");

const coordinates = (path: string) =>
  [...path.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);

test("the axis maximum is a round number at or above the peak", () => {
  assert.equal(niceMaximum(0), 1);
  assert.equal(niceMaximum(1), 1);
  assert.equal(niceMaximum(3), 5);
  assert.equal(niceMaximum(7), 10);
  assert.equal(niceMaximum(36), 50);
  assert.equal(niceMaximum(205), 250);
  for (const peak of [1, 2, 9, 17, 99, 1234, 98765]) assert.ok(niceMaximum(peak) >= peak, String(peak));
});

test("no drawn point ever falls outside the plot area", () => {
  const geometry = chartGeometry(seriesOf([
    ["a", "2026-08-01T12:00:00Z"], ["a", "2026-08-02T12:00:00Z"], ["a", "2026-08-03T12:00:00Z"],
    ["b", "2026-08-03T12:00:00Z"],
  ]));
  for (const drawn of geometry.lines) {
    for (const [x, y] of coordinates(drawn.path)) {
      assert.ok(x >= geometry.plot.left - 0.01, `x ${x} left of plot`);
      assert.ok(x <= geometry.plot.left + geometry.plot.width + 0.01, `x ${x} right of plot`);
      assert.ok(y >= geometry.plot.top - 0.01, `y ${y} above plot`);
      assert.ok(y <= geometry.plot.top + geometry.plot.height + 0.01, `y ${y} below plot`);
    }
  }
});

test("the busiest agent's peak sits inside the frame rather than on its edge", () => {
  const geometry = chartGeometry(seriesOf([["a", "2026-08-01T12:00:00Z"], ["a", "2026-08-02T12:00:00Z"], ["a", "2026-08-03T12:00:00Z"]]));
  const highest = Math.min(...coordinates(geometry.lines[0].path).map(([, y]) => y));
  assert.ok(highest > geometry.plot.top, "peak is clipped against the top of the frame");
});

test("a cumulative line only ever rises to the right", () => {
  const geometry = chartGeometry(seriesOf([
    ["a", "2026-08-01T12:00:00Z"], ["a", "2026-08-03T12:00:00Z"], ["a", "2026-08-03T13:00:00Z"],
  ]));
  const points = coordinates(geometry.lines[0].path);
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(points[index][0] > points[index - 1][0], "x must advance");
    assert.ok(points[index][1] <= points[index - 1][1] + 0.01, "y must never descend on a cumulative line");
  }
});

test("a single day rises from the zero origin to the day's total", () => {
  const geometry = chartGeometry(seriesOf([["a", "2026-08-05T12:00:00Z"]]));
  const drawn = geometry.lines[0];
  const points = coordinates(drawn.path);
  const baseline = geometry.plot.top + geometry.plot.height;
  assert.equal(points.length, 2, "one day is an origin plus that day");
  assert.deepEqual(points[0], [geometry.plot.left, baseline], "the line starts at zero on the left edge");
  assert.ok(points[1][1] < baseline, "the day's total must sit above the baseline");
  assert.equal(drawn.endX, geometry.plot.left + geometry.plot.width);
});

test("every line starts at the zero origin so the opening rise is visible", () => {
  const geometry = chartGeometry(seriesOf([
    ["a", "2026-08-01T12:00:00Z"], ["a", "2026-08-02T12:00:00Z"], ["b", "2026-08-02T12:00:00Z"],
  ]));
  const baseline = geometry.plot.top + geometry.plot.height;
  for (const drawn of geometry.lines) {
    assert.deepEqual(coordinates(drawn.path)[0], [geometry.plot.left, baseline], drawn.agentId);
  }
});

test("the newest day always lands on the right edge of the plot", () => {
  for (const days of [1, 2, 5, 30]) {
    const geometry = chartGeometry(seriesOf(
      Array.from({ length: days }, (_, index) => ["a", `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00Z`] as [string, string]),
    ));
    assert.equal(geometry.lines[0].endX, geometry.plot.left + geometry.plot.width, `${days} days`);
  }
});

test("an empty series still produces a usable frame", () => {
  const geometry = chartGeometry(completionSeries([], "UTC"));
  assert.deepEqual(geometry.lines, []);
  assert.equal(geometry.maxTotal, 1);
  assert.ok(geometry.plot.width > 0 && geometry.plot.height > 0);
});

test("a frame smaller than its own padding never inverts the plot", () => {
  const geometry = chartGeometry(seriesOf([["a", "2026-08-01T12:00:00Z"]]), { width: 10, height: 10 });
  assert.ok(geometry.plot.width >= 1);
  assert.ok(geometry.plot.height >= 1);
});

test("ticks span zero to the maximum without duplicates", () => {
  for (const peak of [1, 3, 36, 205]) {
    const geometry = chartGeometry(seriesOf(
      Array.from({ length: peak }, (_, index) => ["a", `2026-08-01T12:00:${String(index % 60).padStart(2, "0")}Z`] as [string, string]),
    ));
    assert.equal(geometry.ticks[0], 0);
    assert.equal(geometry.ticks[geometry.ticks.length - 1], geometry.maxTotal);
    assert.equal(new Set(geometry.ticks).size, geometry.ticks.length);
  }
});

test("an agent with no completions in the range is pinned to the baseline", () => {
  const geometry = chartGeometry(seriesOf([["busy", "2026-08-01T12:00:00Z"], ["quiet", "2026-08-02T12:00:00Z"]]));
  const quiet = geometry.lines.find((drawn) => drawn.agentId === "quiet");
  assert.ok(quiet);
  const baseline = geometry.plot.top + geometry.plot.height;
  assert.equal(coordinates(quiet.path)[0][1], baseline);
  assert.equal(coordinates(quiet.path)[1][1], baseline, "a day with no completions stays at zero");
});

test("geometry is deterministic for identical input", () => {
  const events: [string, string][] = [["a", "2026-08-01T12:00:00Z"], ["b", "2026-08-02T12:00:00Z"]];
  assert.deepEqual(chartGeometry(seriesOf(events)), chartGeometry(seriesOf(events)));
});
