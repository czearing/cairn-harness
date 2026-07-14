import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

test("operator sees project, agents, queues, and activity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Persona test" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "lead" })).toBeVisible();
  await expect(page.getByText("Prepare and ship the launch.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /lead Delegated launch work/ })).toBeVisible();
  const project = page.getByRole("button", { name: /Persona test/ });
  await expect(project.getByLabel(/\d+ tasks/)).toBeVisible();
  expect(await project.evaluate((node) => getComputedStyle(node).animationName)).not.toBe("none");
  const builder = page.getByRole("button", { name: "Open conversation with builder" }).locator("..");
  await expect(builder.getByText("builder", { exact: true })).toHaveCount(1);
  await expect(builder.getByText("Should the launch include mobile?")).toBeVisible();
  const delegation = page.getByRole("button", { name: /Build the launch page/ });
  await expect(delegation).toContainText("builder · pending");
  await expect(delegation).toContainText("For Prepare and ship the launch.");
  await expect(page.getByLabel("Project leader")).toHaveCount(1);
  await expect(page.getByLabel("Work producer")).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    ready: performance.getEntriesByType("navigation")[0]?.duration || 0,
  }));
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.ready).toBeLessThan(1500);
});

test("project lead adds a task", async ({ page }) => {
  await page.goto("/");
  const inbox = path.join(process.cwd(), ".e2e", "workspace", "work-items", "inbox");
  const drafts = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "drafts");
  const fs = await import("node:fs");
  const before = fs.existsSync(inbox) ? fs.readdirSync(inbox).length : 0;
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Task document" });
  await expect(editor).toHaveText("");
  expect(await editor.evaluate((node) => getComputedStyle(node).boxShadow)).toBe("none");
  await editor.fill("Prepare the launch checklist with mobile verification.");
  await expect.poll(() => fs.readdirSync(drafts).some((name) => fs.readFileSync(path.join(drafts, name), "utf8").includes("Prepare the launch checklist"))).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /Prepare the launch checklist.*draft$/ }).click();
  await expect(page.getByRole("textbox", { name: "Task document" })).toContainText("Prepare the launch checklist");
  await page.getByRole("button", { name: "Send to work" }).click();
  await expect.poll(() => fs.existsSync(inbox) ? fs.readdirSync(inbox).length : 0).toBe(before + 1);
  await expect.poll(() => fs.readdirSync(drafts).some((name) => fs.readFileSync(path.join(drafts, name), "utf8").includes("Prepare the launch checklist"))).toBe(false);
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  const queued = page.getByRole("button", { name: /Prepare the launch checklist.*queued/ }).last();
  await expect(queued).toBeVisible();
  expect(await queued.evaluate((node) => getComputedStyle(node).animationName)).not.toBe("none");
});

test("a direct message wakes a paused project worker", async ({ page }) => {
  const fs = await import("node:fs");
  const record = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "ui-worker.json");
  if (fs.existsSync(record)) {
    const { pid } = JSON.parse(fs.readFileSync(record, "utf8")) as { pid: number };
    try { process.kill(pid); } catch {}
    fs.rmSync(record, { force: true });
  }
  expect(fs.existsSync(record)).toBe(false);
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await dialog.getByRole("textbox").fill("Wake this project only.");
  await dialog.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => fs.existsSync(record)).toBe(true);
});

test("operator messages an individual agent", async ({ page }) => {
  await page.goto("/");
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  const before = messageCount(dbPath);
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  await page.getByRole("dialog", { name: "Conversation with lead" }).getByRole("textbox").fill("Confirm the launch order.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => messageCount(dbPath)).toBe(before + 1);
});

test("agent chat shows human and inter-agent history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await expect(dialog).toBeVisible();
  const response = await page.request.get("/api/projects/.e2e/messages?agent=lead&limit=100");
  const data = await response.json() as { items: { body: string; kind: string; sender: string; title?: string }[] };
  const payload = JSON.stringify(data);
  expect(payload).toContain("Build the launch page.");
  expect(payload).toContain("Should the launch include mobile?");
  expect(payload).toContain("Delegated launch work.");
  expect(payload).toContain("Launch plan attached.");
  expect(payload).toContain("I am checking the launch dependencies.");
  expect(payload).toContain("Used view");
  expect(payload).not.toContain("SYSTEM ROLE: private harness instructions");
  expect(payload).not.toContain("PRIVATE CAIRN REASONING");
  const tools = data.items.filter((message) => message.kind === "tool");
  expect(tools).toHaveLength(1);
  expect(tools[0]).toMatchObject({ sender: "lead", title: "Used view" });
});

test("todo and activity rows open their full source context", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Build the launch page/ }).click();
  const delegated = page.getByRole("dialog", { name: "Conversation with builder" });
  const sent = delegated.locator('[data-chat-id="message:mtodo"]');
  await expect(sent).toBeVisible();
  await expect(sent).toBeFocused();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /Delegated launch work/ }).click();
  const chat = page.getByRole("dialog", { name: "Conversation with lead" });
  const turn = chat.locator('[data-chat-id="turn:1"]');
  await expect(turn).toBeVisible();
  await expect(turn).toBeFocused();
  const history = page.getByLabel("Conversation history with lead");
  await history.evaluate((node) => node.scrollTo({ top: 0 }));
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBe(0);
  await history.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
});

test("in-progress task opens its assignment in chat", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Prepare and ship the launch.*in-progress/ }).click();
  const chat = page.getByRole("dialog", { name: "Conversation with lead" });
  const assignment = chat.locator('[data-chat-id="message:work-message"]');
  await expect(assignment).toBeVisible();
  await expect(assignment).toBeFocused();
});

test("completed tasks stay in an expandable history", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Research the launch audience/ })).toHaveCount(0);
  await page.getByText("1 completed task", { exact: true }).click();
  await expect(page.getByRole("button", { name: /Research the launch audience.*Done/ })).toBeVisible();
});

test("completed delegated todo leaves the active list", async ({ page }) => {
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE messages SET status='completed' WHERE id='mtodo'").run();
  db.close();
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Build the launch page/ })).toHaveCount(0);
  const restore = new DatabaseSync(dbPath);
  restore.prepare("UPDATE messages SET status='pending' WHERE id='mtodo'").run();
  restore.close();
});

test("first-time user creates a project from the rail", async ({ page }, testInfo) => {
  await page.goto("/");
  const name = `Created ${testInfo.project.name}`;
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByLabel("Agents").fill("lead | Project lead | Plan work.\nbuilder | Builder | Build work.");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("failed work mutation keeps the drawer and input", async ({ page }) => {
  await page.route("**/work-items", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Disk unavailable"}' }));
  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  const textbox = page.getByRole("textbox", { name: "Task document" });
  await textbox.fill("Preserve this request.");
  await page.getByRole("button", { name: "Send to work" }).click();
  await expect(page.getByText("Disk unavailable", { exact: true })).toBeVisible();
  await expect(textbox).toContainText("Preserve this request.");
  await expect(textbox).toBeVisible();
});

test("invalid duplicate agents keep project input visible", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  const name = `Invalid ${testInfo.project.name}`;
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByLabel("Agents").fill("lead | Lead | Plan.\nlead | Other lead | Plan again.");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Agent names must be unique");
  await expect(dialog.getByLabel("Project name")).toHaveValue(name);
});

test("agent avatar owns persistent color and picture settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  const color = page.getByLabel("lead color");
  await color.fill("#ff9900");
  await page.getByRole("button", { name: "lead picture" }).setInputFiles(path.join(process.cwd(), "..", "docs", "dashboard.png"));
  await expect.poll(() => page.getByRole("img", { name: "lead picture preview" }).evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("data:image/webp");
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  const avatar = page.getByLabel("Project leader").locator("..");
  await expect.poll(() => avatar.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("data:image/webp");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  await expect(page.getByLabel("lead color")).toHaveValue("#ff9900");
});

test("agent menu edits the configured prompt", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Edit prompt" }).click();
  const editor = page.getByRole("textbox", { name: "lead prompt" });
  await editor.fill("Lead the project and verify every result.");
  await page.getByRole("button", { name: "Save prompt" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const config = JSON.parse((await import("node:fs")).readFileSync(path.join(process.cwd(), ".e2e", "project.json"), "utf8")) as { roles: { name: string; prompt: string }[] };
  expect(config.roles.find((role) => role.name === "lead")?.prompt).toContain("verify every result");
});

test("settings owns project colors but not agent identity", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("lead color")).toHaveCount(0);
  const color = page.getByLabel("Persona test project color");
  await color.fill("#ff5500");
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  const project = page.getByRole("button", { name: /Persona test/ });
  await expect.poll(() => project.evaluate((node) => getComputedStyle(node).getPropertyValue("--project-color"))).toBe("#ff5500");
});

test("chat uses accent for the user and stable identity colors for agents", async ({ page }) => {
  await page.goto("/");
  const lead = page.getByRole("button", { name: "Open conversation with lead" });
  const builder = page.getByRole("button", { name: "Open conversation with builder" });
  const [leadColor, builderColor] = await Promise.all([
    lead.evaluate((node) => getComputedStyle(node).getPropertyValue("--agent-color")),
    builder.evaluate((node) => getComputedStyle(node).getPropertyValue("--agent-color")),
  ]);
  expect(leadColor).not.toBe(builderColor);
  await page.getByRole("button", { name: /lead Delegated launch work/ }).click();
  let dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  const agent = dialog.locator("article", { hasText: "Delegated launch work." });
  await expect(agent).toBeVisible();
  expect(await agent.evaluate((node) => getComputedStyle(node.parentElement!).justifyContent)).toBe("normal");
  await page.getByRole("button", { name: "Close" }).click();
  await lead.click();
  dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await dialog.getByRole("textbox").fill("Accent alignment check.");
  await dialog.getByRole("button", { name: "Send message" }).click();
  const user = dialog.locator("article", { hasText: "Accent alignment check." });
  await expect(user).toContainText("You");
  expect(await user.evaluate((node) => getComputedStyle(node.parentElement!).justifyContent)).toBe("flex-end");
});

test("opening a conversation lands on the latest message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const history = page.getByLabel("Conversation history with lead");
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  expect(await history.evaluate((node) => getComputedStyle(node).scrollbarColor)).not.toBe("auto");
  const drawer = page.getByRole("dialog", { name: "Conversation with lead" });
  const width = await drawer.evaluate((node) => node.getBoundingClientRect().width);
  if ((page.viewportSize()?.width || 0) > 720) expect(width).toBeGreaterThanOrEqual(600);
});

test("large histories render a small window and load older pages on scroll", async ({ page }) => {
  const snapshot = await page.request.get("/api/projects");
  expect(await snapshot.text()).not.toContain('"conversations"');
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  const history = page.getByLabel("Conversation history with lead");
  await expect(dialog.getByText("Archived message 000")).toHaveCount(0);
  expect(await dialog.locator("article").count()).toBeLessThan(40);
  let before = "";
  const archived: string[] = [];
  for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
    const query = new URLSearchParams({ agent: "lead", limit: "80" });
    if (before) query.set("before", before);
    const response = await page.request.get(`/api/projects/.e2e/messages?${query}`);
    const result = await response.json() as { items: { body: string }[]; hasMore: boolean; nextBefore?: string };
    archived.push(...result.items.map((message) => message.body));
    before = result.nextBefore || "";
    if (!result.hasMore) break;
  }
  expect(archived).toContain("Archived message 000");
  await expect.poll(async () => {
    await history.evaluate((node) => node.scrollTo({ top: 0 }));
    return dialog.getByText("Archived message 000").count();
  }, { timeout: 12000, intervals: [300, 500, 700] }).toBe(1);
  expect(await dialog.locator("article").count()).toBeLessThan(50);
});

test("idle dashboard does not poll and opens chat immediately", async ({ page }) => {
  let projects = 0;
  let messages = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "GET" && url.endsWith("/api/projects")) projects++;
    if (request.method() === "GET" && url.includes("/messages?")) messages++;
  });
  await page.goto("/");
  await page.waitForTimeout(500);
  const projectBaseline = projects;
  await page.waitForTimeout(3500);
  expect(projects).toBe(projectBaseline);
  const started = Date.now();
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  await expect(page.getByRole("dialog", { name: "Conversation with lead" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(500);
  await page.waitForTimeout(500);
  const messageBaseline = messages;
  await page.waitForTimeout(3500);
  expect(messages).toBe(messageBaseline);
});

test("local database changes update the UI without polling", async ({ page }) => {
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  await page.goto("/");
  await page.waitForTimeout(200);
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE agents SET status='failed' WHERE agent_id='builder'").run();
  db.close();
  const card = page.getByRole("button", { name: "Open conversation with builder" }).locator("..");
  await expect(card.getByText("failed", { exact: true })).toBeVisible();
  const restore = new DatabaseSync(dbPath);
  restore.prepare("UPDATE agents SET status='idle' WHERE agent_id='builder'").run();
  restore.close();
});

test("UI starts one project worker and mutations do not duplicate it", async ({ page }) => {
  const fs = await import("node:fs");
  const record = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "ui-worker.json");
  await expect.poll(() => fs.existsSync(record)).toBe(true);
  const first = JSON.parse(fs.readFileSync(record, "utf8")) as { pid: number };
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await dialog.getByRole("textbox").fill("Keep the same worker.");
  await dialog.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => (JSON.parse(fs.readFileSync(record, "utf8")) as { pid: number }).pid).toBe(first.pid);
});

function messageCount(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const count = Number((db.prepare("SELECT COUNT(*) count FROM messages WHERE recipient='lead'").get() as { count: number }).count);
  db.close();
  return count;
}
