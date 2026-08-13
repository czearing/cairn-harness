import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { watchProjectScoped, type ProjectWatcher } from "./scoped-project-watcher.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

function project() {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-scoped-watch-"));
  mkdirSync(path.join(root, "work-items", "inbox"), { recursive: true });
  mkdirSync(path.join(root, ".cairn-harness", "live-responses"), { recursive: true });
  writeFileSync(path.join(root, "project.json"), "{}");
  return root;
}

function session(root: string, agent: string, id: string) {
  const directory = path.join(root, ".cairn-harness", "copilot-home", agent, "session-state", id);
  mkdirSync(path.join(directory, "files", "target", "debug"), { recursive: true });
  writeFileSync(path.join(directory, "events.jsonl"), "");
  return directory;
}

function collect(root: string) {
  const seen: string[] = [];
  const watcher = watchProjectScoped(root, (_event, file) => {
    seen.push(String(file || "").replaceAll("\\", "/"));
  });
  return { seen, watcher };
}

function cleanup(root: string, watcher: ProjectWatcher) {
  watcher.close();
  rmSync(root, { recursive: true, force: true });
}

test("reports the session event log an agent appends to", async () => {
  const root = project();
  const directory = session(root, "implementer", "0cfadcc6-3aca-4292-86a3-e9041d981ada");
  const { seen, watcher } = collect(root);

  writeFileSync(path.join(directory, "events.jsonl"), '{"type":"turn"}\n');
  await settle();

  assert.ok(
    seen.some((file) => file.endsWith("session-state/0cfadcc6-3aca-4292-86a3-e9041d981ada/events.jsonl")),
    `session event log was not reported, saw ${JSON.stringify(seen)}`,
  );
  cleanup(root, watcher);
});

test("ignores the build artefacts an agent writes inside its session workspace", async () => {
  const root = project();
  const directory = session(root, "implementer", "0cfadcc6-3aca-4292-86a3-e9041d981ada");
  const { seen, watcher } = collect(root);

  for (let index = 0; index < 40; index++) {
    writeFileSync(path.join(directory, "files", "target", "debug", `artefact-${index}.o`), "x");
  }
  await settle();

  assert.deepEqual(seen.filter((file) => file.includes("/files/")), []);
  cleanup(root, watcher);
});

test("reports project, work item and database changes", async () => {
  const root = project();
  const { seen, watcher } = collect(root);

  writeFileSync(path.join(root, "project.json"), '{"name":"changed"}');
  writeFileSync(path.join(root, "work-items", "inbox", "item.md"), "work");
  writeFileSync(path.join(root, ".cairn-harness", "harness.db-wal"), "wal");
  writeFileSync(path.join(root, ".cairn-harness", "live-responses", "implementer.json"), "{}");
  await settle();

  assert.ok(seen.includes("project.json"), `project.json missing from ${JSON.stringify(seen)}`);
  assert.ok(seen.some((file) => file.startsWith("work-items/")), "work item change missing");
  assert.ok(seen.includes(".cairn-harness/harness.db-wal"), "database change missing");
  assert.ok(seen.includes(".cairn-harness/live-responses/implementer.json"), "live response missing");
  cleanup(root, watcher);
});

test("picks up a session created after watching began", async () => {
  const root = project();
  mkdirSync(path.join(root, ".cairn-harness", "copilot-home", "implementer", "session-state"), {
    recursive: true,
  });
  const { seen, watcher } = collect(root);

  const directory = session(root, "implementer", "8625dd8e-69c2-4fb5-82f5-cce024543da4");
  await settle();
  writeFileSync(path.join(directory, "events.jsonl"), '{"type":"turn"}\n');
  await settle();

  assert.ok(
    seen.some((file) => file.endsWith("session-state/8625dd8e-69c2-4fb5-82f5-cce024543da4/events.jsonl")),
    `new session was not picked up, saw ${JSON.stringify(seen)}`,
  );
  cleanup(root, watcher);
});
