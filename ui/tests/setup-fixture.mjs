import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = path.join(process.cwd(), ".e2e");
rmSync(directory, { recursive: true, force: true });
mkdirSync(path.join(directory, "workspace", ".cairn-harness"), { recursive: true });
mkdirSync(path.join(directory, "workspace", "todos"), { recursive: true });
mkdirSync(path.join(directory, "workspace", "work-items", "in-progress"), { recursive: true });
writeFileSync(path.join(directory, "project.json"), JSON.stringify({
  name: "Persona test",
  root: "workspace",
  leader: "lead",
  work_dir: "work-items",
  roles: [
    { name: "lead", description: "Project lead", prompt: "Plan and delegate." },
    { name: "builder", description: "Builder", prompt: "Complete assigned work." },
  ],
}));
writeFileSync(path.join(directory, "workspace", "todos", "build.todo"), "to: builder\n\nBuild the launch page.");
writeFileSync(path.join(directory, "workspace", "work-items", "in-progress", "launch.md"), "Prepare and ship the launch.");
const db = new DatabaseSync(path.join(directory, "workspace", ".cairn-harness", "harness.db"));
db.exec(`
  CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
  CREATE TABLE messages(id TEXT PRIMARY KEY,sender TEXT,recipient TEXT,topic TEXT,body TEXT,status TEXT,created_at TEXT);
  CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
  CREATE TABLE work_items(id TEXT PRIMARY KEY,path TEXT,status TEXT,created_at TEXT);
  CREATE TABLE todo_files(path TEXT PRIMARY KEY,ingested_at TEXT);
  CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
  INSERT INTO agents VALUES('lead','Project lead','s1','working','roadmap','2026-07-13T12:00:00Z');
  INSERT INTO agents VALUES('builder','Builder','s2','idle',NULL,'2026-07-13T12:00:00Z');
  INSERT INTO work_items VALUES('w1','work-items/in-progress/launch.md','in-progress','2026-07-13T12:00:00Z');
  INSERT INTO todo_files VALUES('todos/build.todo','2026-07-13T12:01:00Z');
  INSERT INTO messages VALUES('m1','lead','builder','handoff','Build the launch page.','completed','2026-07-13T12:01:15Z');
  INSERT INTO messages VALUES('m2','builder','lead','question','Should the launch include mobile?','pending','2026-07-13T12:01:30Z');
  INSERT INTO turns VALUES(1,'lead','completed','{"summary":"Delegated launch work.","deliverable":"Launch plan attached."}','2026-07-13T12:02:00Z');
`);
db.close();
