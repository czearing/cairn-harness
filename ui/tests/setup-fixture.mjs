import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const directory = path.join(process.cwd(), ".e2e");
const archived = Array.from({ length: 240 }, (_, index) => ({
  type: "assistant.message",
  timestamp: new Date(Date.UTC(2026, 6, 12, 8, 0, index)).toISOString(),
  data: { content: `Archived message ${String(index).padStart(3, "0")}` },
}));
rmSync(directory, { recursive: true, force: true });
const worker = path.join(directory, process.platform === "win32" ? "fake-worker.exe" : "fake-worker");
mkdirSync(directory, { recursive: true });
const compile = spawnSync("rustc", ["tests/fake-worker.rs", "-o", worker], { stdio: "inherit" });
if (compile.status !== 0) throw new Error("Could not compile the supervisor test worker");
mkdirSync(path.join(directory, "workspace", ".cairn-harness"), { recursive: true });
mkdirSync(path.join(directory, "workspace", ".cairn-harness", "drafts"), { recursive: true });
mkdirSync(path.join(directory, "workspace", ".cairn-harness", "copilot-home", "lead", "session-state", "s0"), { recursive: true });
mkdirSync(path.join(directory, "workspace", ".cairn-harness", "copilot-home", "lead", "session-state", "s1"), { recursive: true });
mkdirSync(path.join(directory, "workspace", "todos"), { recursive: true });
mkdirSync(path.join(directory, "workspace", "work-items", "in-progress"), { recursive: true });
writeFileSync(path.join(directory, "project.json"), JSON.stringify({
  name: "Persona test",
  root: "workspace",
  leader: "lead",
  producer: "lead",
  work_dir: "work-items",
  roles: [
    { name: "lead", description: "Project lead", prompt: "Plan and delegate." },
    { name: "builder", description: "Builder", prompt: "Complete assigned work." },
  ],
}));
writeFileSync(path.join(directory, "workspace", "todos", "build.todo"), "to: builder\n\nBuild the launch page.");
writeFileSync(path.join(directory, "workspace", ".cairn-harness", "drafts", "existing.md"), "Existing draft task.");
writeFileSync(path.join(directory, "workspace", "work-items", "in-progress", "launch.md"), "Prepare and ship the launch.");
writeFileSync(
  path.join(directory, "workspace", ".cairn-harness", "copilot-home", "lead", "session-state", "s0", "events.jsonl"),
  [
    { type: "session.start", timestamp: "2026-07-12T12:00:00Z", data: { sessionId: "s0" } },
    ...archived,
    { type: "assistant.message", timestamp: "2026-07-12T12:00:10Z", data: { content: "I survived the previous session." } },
    { type: "session.shutdown", timestamp: "2026-07-12T12:01:00Z", data: {} },
  ].map(JSON.stringify).join("\n"),
);
writeFileSync(
  path.join(directory, "workspace", ".cairn-harness", "copilot-home", "lead", "session-state", "s1", "events.jsonl"),
  [
    { type: "session.start", timestamp: "2026-07-13T12:00:00Z", data: { sessionId: "s1" } },
    { type: "user.message", timestamp: "2026-07-13T12:00:05Z", data: { content: "SYSTEM ROLE: private harness instructions" } },
    { type: "assistant.message", timestamp: "2026-07-13T12:00:10Z", data: { reasoningText: "PRIVATE CAIRN REASONING", content: "I am checking the launch dependencies." } },
    { type: "assistant.message", timestamp: "2026-07-13T12:00:11Z", data: { content: "CAIRN_ENVELOPE_BEGIN\n{\"summary\":\"Readable agent summary.\",\"deliverable\":null,\"messages\":[],\"complete\":true}\nCAIRN_ENVELOPE_END" } },
    { type: "assistant.message", timestamp: "2026-07-13T12:00:12Z", data: { content: "## Build notes\n\n- Checked the launch path\n- Kept `mobile` support" } },
    { type: "tool.execution_start", timestamp: "2026-07-13T12:00:20Z", data: { toolCallId: "tool-1", toolName: "view", arguments: { path: "launch.md" } } },
    { type: "tool.execution_complete", timestamp: "2026-07-13T12:00:21Z", data: { toolCallId: "tool-1", success: true, result: { content: "{\"status\":\"complete\"}" } } },
    { type: "session.shutdown", timestamp: "2026-07-13T12:03:00Z", data: {} },
  ].map(JSON.stringify).join("\n"),
);
const db = new DatabaseSync(path.join(directory, "workspace", ".cairn-harness", "harness.db"));
db.exec(`
  CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
  CREATE TABLE messages(id TEXT PRIMARY KEY,sender TEXT,recipient TEXT,topic TEXT,body TEXT,status TEXT,created_at TEXT);
  CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
  CREATE TABLE work_items(id TEXT PRIMARY KEY,path TEXT,message_id TEXT,status TEXT,created_at TEXT);
  CREATE TABLE todo_files(path TEXT PRIMARY KEY,message_id TEXT,ingested_at TEXT);
  CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
  INSERT INTO agents VALUES('lead','Project lead','s1','working','roadmap','2026-07-13T12:00:00Z');
  INSERT INTO agents VALUES('builder','Builder','s2','idle',NULL,'2026-07-13T12:00:00Z');
  INSERT INTO work_items VALUES('w1','work-items/in-progress/launch.md','work-message','in-progress','2026-07-13T12:00:00Z');
  INSERT INTO todo_files VALUES('todos/build.todo','mtodo','2026-07-13T12:01:00Z');
  INSERT INTO messages VALUES('m0','dashboard','lead','request','Start with the product accent.','pending','2026-07-13T12:01:00Z');
  INSERT INTO messages VALUES('work-message','work-items','lead','work-item','Prepare and ship the launch.','pending','2026-07-13T12:00:00Z');
  INSERT INTO messages VALUES('mtodo','todo-folder','builder','todos/build.todo','Build the launch page.','pending','2026-07-13T12:01:05Z');
  INSERT INTO messages VALUES('m1','lead','builder','handoff','Build the launch page.','completed','2026-07-13T12:01:15Z');
  INSERT INTO messages VALUES('m2','builder','lead','question','Should the launch include mobile?','pending','2026-07-13T12:01:30Z');
  INSERT INTO turns VALUES(1,'lead','completed','{"summary":"Delegated launch work.","deliverable":"Launch plan attached."}','2026-07-13T12:02:00Z');
`);
db.close();
