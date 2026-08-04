import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

test("operator sees project, agents, queues, and activity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Persona test" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^(Leader|Idea Agents|Team Agents)$/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Lead", exact: true })).toBeVisible();
  await expect(page.getByText("Prepare and ship the launch.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /lead Delegated launch work/ })).toBeVisible();
  const project = page.getByRole("button", { name: /Persona test.*tasks/ });
  await expect(project.getByLabel(/\d+ tasks/)).toBeVisible();
  expect(await project.evaluate((node) => getComputedStyle(node).animationName)).not.toBe("none");
  const builder = page.getByRole("button", { name: "Open conversation with builder" }).locator("..");
  await expect(builder.getByText("Builder", { exact: true })).toHaveCount(1);
  await expect(builder.getByText("1 active assignment", { exact: true })).toHaveCount(0);
  await expect(builder.getByText("Build the launch page.", { exact: true })).toHaveCount(0);
  await expect(builder.getByText("Should the launch include mobile?")).toHaveCount(0);
  const workHeading = page.getByRole("heading", { name: "Active work" });
  const agentsHeading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(workHeading).toBeVisible();
  expect(await agentsHeading.evaluate((agents, work) => Boolean(agents.compareDocumentPosition(work as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await workHeading.elementHandle())).toBe(true);
  const root = page.getByRole("button", { name: /^Prepare and ship the launch/ });
  await expect(root).toContainText("Running");
  await expect(root).toContainText("1/2 complete");
  const delegation = page.getByRole("list", { name: "Delegated tasks for Prepare and ship the launch." })
    .getByRole("button")
    .filter({ hasText: "Build the launch page." })
    .first();
  await expect(delegation).toContainText("Builder");
  await expect(delegation).toContainText("Queued");
  await delegation.locator("..").getByRole("button", { name: /Actions for delegated action/ }).click();
  await expect(page.getByRole("menuitem", { name: "Cancel delegated action" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete delegated action" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Build the launch page.*Completed/ })).toHaveCount(0);
  await page.getByText(/^History \(\d+\)$/).click();
  const completedDelegation = page.getByRole("list", { name: "Historical delegations" })
    .getByRole("button")
    .filter({ hasText: "Build the launch page." })
    .last();
  await completedDelegation.locator("..").getByRole("button", { name: /Actions for delegated action/ }).click();
  await expect(page.getByRole("menuitem", { name: "Delete delegated action" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Cancel delegated action" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Project leader")).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    ready: performance.getEntriesByType("navigation")[0]?.duration || 0,
  }));
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.ready).toBeLessThan(1500);
});

test("agent cards stay centered and bounded without shrinking mobile cards", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/");
  const desktop = await page.locator("[data-agent-id]").evaluateAll((hits) => {
    const cards = hits.map((hit) => hit.closest<HTMLElement>("[data-card-interactive]")!).filter(Boolean);
    const grid = hits[0]?.closest<HTMLElement>("[class*='agentGrid']")?.getBoundingClientRect();
    const rows = new Map<number, DOMRect[]>();
    for (const card of cards) {
      const bounds = card.getBoundingClientRect();
      const row = Math.round(bounds.top);
      rows.set(row, [...(rows.get(row) || []), bounds]);
    }
    return {
      widths: cards.map((card) => card.getBoundingClientRect().width),
      insetDeltas: cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        const header = card.querySelector<HTMLElement>("[class*='cardHeader']")!.getBoundingClientRect();
        return Math.abs((header.top - bounds.top) - (bounds.bottom - header.bottom));
      }),
      rowGapDeltas: [...rows.values()].map((row) => {
        const ordered = row.sort((a, b) => a.left - b.left);
        return Math.abs((ordered[0].left - grid!.left) - (grid!.right - ordered.at(-1)!.right));
      }),
    };
  });
  expect(Math.max(...desktop.widths)).toBeLessThanOrEqual(321);
  expect(Math.max(...desktop.insetDeltas)).toBeLessThanOrEqual(1);
  expect(Math.max(...desktop.rowGapDeltas)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator("[data-agent-id]").first().evaluate((hit) => {
    const card = hit.closest<HTMLElement>("[data-card-interactive]")!.getBoundingClientRect();
    const grid = hit.closest<HTMLElement>("[class*='agentGrid']")!.getBoundingClientRect();
    return { cardWidth: card.width, gridWidth: grid.width };
  });
  expect(Math.abs(mobile.cardWidth - mobile.gridWidth)).toBeLessThanOrEqual(1);
});

test("active work scan path stays truthful and compact on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const root = page.getByRole("button", { name: /^Prepare and ship the launch/ });
  const owner = root.locator("span").filter({ hasText: /^(Lead|lead|Unassigned)$/ });
  await expect(root).toContainText("Running");
  await expect(root).toContainText("1/2 complete");
  await expect(owner).toHaveText(/^(Lead|lead|Unassigned)$/);
  await expect(root).toHaveAccessibleName(/Prepare and ship the launch.*Owner: (Lead|lead|Unassigned).*Running.*1 of 2 delegated complete/);
  const geometry = await root.evaluate((button) => {
    const article = button.closest("article")!;
    const title = button.querySelector<HTMLElement>("[data-work-body]")!;
    const children = article.querySelector<HTMLElement>("[role='list']");
    return {
      animationName: getComputedStyle(article).animationName,
      backgroundImage: getComputedStyle(article).backgroundImage,
      lineClamp: getComputedStyle(title).webkitLineClamp,
      childIndent: children ? children.getBoundingClientRect().left - article.getBoundingClientRect().left : 0,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(geometry.animationName).toBe("none");
  expect(geometry.backgroundImage).toBe("none");
  expect(geometry.lineClamp).toBe("2");
  expect(geometry.childIndent).toBeLessThanOrEqual(12);
  expect(geometry.overflow).toBeLessThanOrEqual(0);
});

test("saved drafts stay in the draft editor and never render as work", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [project] = await response.json() as Array<{
    id: string;
    drafts: Array<{ id: string; title: string; content: string }>;
  }>;
  const draft = project.drafts[0];
  expect(draft).toBeTruthy();
  const draftLabel = draft.content.trim().split(/\r?\n/, 1)[0].replace(/^#+\s*/, "");
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/") && request.failure()?.errorText !== "net::ERR_ABORTED") {
      requestErrors.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 640 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const work = page.getByRole("heading", { name: "Active work" }).locator("..");
    await expect(work.getByText(draftLabel, { exact: true })).toHaveCount(0);
    await expect(work.getByText("Prepare and ship the launch.", { exact: true })).toBeVisible();
    await expect(work.getByText("Build the launch page.", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: draftLabel })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: draftLabel }).getByLabel("Draft editor")).toBeVisible();
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations).toEqual([]);
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(requestErrors).toEqual([]);
});

test("retryable startup failure projects as queued work without health attention", async ({ page }, testInfo) => {
  const response = await page.request.get("/api/projects");
  const [baseline] = await response.json() as Array<Record<string, unknown>>;
  const agents = baseline.agents as Array<Record<string, unknown>>;
  const target = agents.find((agent) => agent.id === "principal-dev") || agents[0];
  const agentId = String(target.id);
  const workItemTemplate = ((baseline.workItems as Array<Record<string, unknown>> | undefined) || [])[0] || {};
  const workItems = [0, 1, 2].map((index) => ({
    ...workItemTemplate,
    id: `recoverable-root-${index}`,
    title: `Recoverable operator root ${index + 1}`,
    content: `Recoverable operator root ${index + 1}`,
    meta: agentId,
    agentId,
    executorId: agentId,
    status: "queued",
    statusLabel: "Queued",
    rawStatus: "pending",
    canonicalStatus: "queued",
    taskKind: "root",
    updatedAt: `2026-07-16T16:0${index}:00Z`,
  }));
  let projected = false;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/") && request.failure()?.errorText !== "net::ERR_ABORTED") {
      requestErrors.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        ...baseline,
        agents: agents.map((agent) => agent.id === agentId ? {
          ...agent,
          status: projected ? "idle" : "failed",
          topic: undefined,
        } : agent),
        workItems,
        delegatedActions: [],
        workItemCount: workItems.length,
        activeWorkCount: workItems.length,
      }]),
    });
  });
  await page.route("**/api/health", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projected
        ? { status: "healthy", label: "All systems operational", issues: [] }
        : {
            status: "attention",
            label: "1 issue",
            issues: [{
              projectId: baseline.id,
              projectName: baseline.name,
              summary: "1 failed agent",
              transcript: `${agentId}: No active topic`,
            }],
          }),
    });
  });

  await page.goto("/");
  const card = page.getByRole("button", { name: `Open conversation with ${agentId}` }).locator("..");
  await expect(card.getByText("Failed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1 issue" }).click();
  await expect(page.getByText(`${agentId}: No active topic`, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agent-health-before.png"), fullPage: true });

  projected = true;
  await page.reload();
  await expect(card.getByText("Idle", { exact: true })).toBeVisible();
  await expect(card.getByText("Failed", { exact: true })).toHaveCount(0);
  for (const item of workItems) {
    await expect(page.getByRole("button", { name: new RegExp(`^${String(item.title)} Queued`) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: `More options for ${agentId}` })).toBeVisible();
  await page.getByRole("button", { name: "All systems operational" }).click();
  await expect(page.getByText("No active errors are recorded.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restart agents" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reload dashboard" })).toBeVisible();

  for (const [width, height, name] of [[1440, 900, "desktop"], [960, 426, "short"]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .include("main")
      .include("[class*='SystemStatus-module']")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`agent-health-after-${name}.png`), fullPage: true });
  }
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(requestErrors).toEqual([]);
});

test("work map keeps multiple assignments and orphaned delegations visible", async ({ page }) => {
  const fixtureDirectory = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const dbPath = path.join(process.cwd(), fixtureDirectory, "workspace", ".cairn-harness", "harness.db");
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "second-assignment", "work-message", null, "delegation", "agent", "lead", "builder",
      "review", "Review launch accessibility.", null, "waiting", 0, null,
      "2026-07-13T12:01:10Z", null, null,
    );
    db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "orphan-assignment", "missing-root", null, "delegation", "agent", "lead", "",
      "investigate", "Recover missing plan context.", null, "blocked", 0, null,
      "2026-07-13T12:01:11Z", null, null,
    );
    db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "cycle-a", "cycle-b", null, "delegation", "agent", "lead", "",
      "cycle-a", "Cycle part A.", null, "waiting", 0, null,
      "2026-07-13T12:01:12Z", null, null,
    );
    db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "cycle-b", "cycle-a", null, "delegation", "agent", "lead", "",
      "cycle-b", "Cycle part B.", null, "waiting", 0, null,
      "2026-07-13T12:01:13Z", null, null,
    );
  } finally {
    db.close();
  }

  try {
    await page.goto("/");
    const builder = page.getByRole("button", { name: "Open conversation with builder" }).locator("..");
    await expect(builder.getByText("2 active assignments", { exact: true })).toBeVisible();
    const children = page.getByRole("list", { name: "Delegated tasks for Prepare and ship the launch." });
    await expect(children.getByRole("button").filter({ hasText: "Review launch accessibility." })).toContainText("Waiting");
    const orphans = page.getByRole("region", { name: "Orphaned delegations" });
    await expect(orphans).toContainText("Plan health: parent task is missing.");
    const orphan = orphans.getByRole("button").filter({ hasText: "Recover missing plan context." }).first();
    await expect(orphan).toContainText("Unassigned");
    await expect(orphan).toContainText("Blocked");
    await expect(orphans.getByRole("button")
      .filter({ hasText: "Cycle part A." })
      .filter({ hasText: "Plan health: delegation cycle detected." })).toBeVisible();
  } finally {
    const cleanup = new DatabaseSync(dbPath, { timeout: 5000 });
    cleanup.prepare("DELETE FROM tasks WHERE id IN ('second-assignment','orphan-assignment','cycle-a','cycle-b')").run();
    cleanup.close();
  }
});

test("terminal orphaned delegations stay out of the DOM until history opens", async ({ page }) => {
  const fixtureDirectory = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const dbPath = path.join(process.cwd(), fixtureDirectory, "workspace", ".cairn-harness", "harness.db");
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "completed-orphan", "missing-completed-root", null, "delegation", "agent", "lead", "builder",
    "completed-orphan", "Archived delegated task.", null, "completed", 1, null,
    "2026-07-13T12:01:14Z", "2026-07-13T12:01:15Z", "2026-07-13T12:01:16Z",
  );
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "failed-orphan", "missing-failed-root", null, "delegation", "agent", "lead", "builder",
    "failed-orphan", "Failed archived task.", null, "failed", 1, "Validation failed.",
    "2026-07-13T12:01:17Z", "2026-07-13T12:01:18Z", "2026-07-13T12:01:19Z",
  );
  db.close();
  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Archived delegated task.*Completed/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Failed archived task.*Failed/ })).toHaveCount(0);
    await page.getByText(/^History \(\d+\)$/).click();
    await expect(page.getByRole("button", { name: /Archived delegated task.*Completed/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Failed archived task.*Failed/ })).toBeVisible();
  } finally {
    const cleanup = new DatabaseSync(dbPath, { timeout: 5000 });
    cleanup.prepare("DELETE FROM tasks WHERE id IN ('completed-orphan','failed-orphan')").run();
    cleanup.close();
  }
});

test("global and per-agent model settings persist stable model IDs", async ({ page }) => {
  const settings = {
    defaultModel: "gpt-5.4-mini",
    models: [
      { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
      { id: "gpt-5.5", name: "GPT-5.5" },
    ],
    catalog: { status: "ready" },
  };
  let globalSave: Record<string, unknown> | undefined;
  let agentSave: Record<string, unknown> | undefined;
  await page.route("**/api/settings", async (route, request) => {
    if (request.method() === "PUT") {
      globalSave = request.postDataJSON() as Record<string, unknown>;
      settings.defaultModel = String(globalSave.defaultModel);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ defaultModel: settings.defaultModel }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(settings) });
  });

  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    agentSave = request.postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Global settings" }).click();
  const globalDrawer = page.getByRole("dialog", { name: "Global settings" });
  await globalDrawer.getByLabel("Global default model").selectOption("gpt-5.5");
  await globalDrawer.getByRole("button", { name: "Save default" }).click();
  await expect.poll(() => globalSave).toEqual({ defaultModel: "gpt-5.5" });
  await globalDrawer.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Configure lead" }).click();
  const agentWorkspace = page.getByRole("main", { name: "Lead" });
  await agentWorkspace.getByRole("tab", { name: "Model", exact: true }).click();
  const agentModel = agentWorkspace.getByRole("combobox", { name: "Model" });
  await expect(agentModel).toHaveValue("");
  await expect(agentModel.locator("option").first()).toHaveText("Default — GPT-5.5");
  await agentModel.selectOption("gpt-5.4-mini");
  await expect.poll(() => agentSave).toEqual({ model: { model: "gpt-5.4-mini" } });
  await agentWorkspace.getByRole("tab", { name: "Profile", exact: true }).click();
  await agentWorkspace.getByLabel("Title").fill("Principal");
  await expect.poll(() => agentSave).toEqual({
    details: { title: "Principal", description: "Project lead" },
  });
});

test("catalog discovery failure keeps configured override unknown and does not block details or inheritance", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const projects = await response.json() as Array<Record<string, unknown>>;
  const lead = ((projects[0].agents as Array<Record<string, unknown>>).find((agent) => agent.id === "lead"))!;
  lead.model = "gpt-5.5";
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route("**/api/settings", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        defaultModel: "gpt-5.4-mini",
        models: [],
        catalog: {
          status: "error",
          code: "copilot-not-found",
          message: "The Copilot CLI could not be started",
          detail: "spawn copilot ENOENT",
        },
      }),
    });
  });
  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    writes.push(request.postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Global settings" }).click();
  const globalDrawer = page.getByRole("dialog", { name: "Global settings" });
  await expect(globalDrawer.getByText("Models couldn’t be checked", { exact: true })).toBeVisible();
  await expect(globalDrawer.getByText(/Configured model:.*gpt-5.4-mini.*Availability is unknown/)).toBeVisible();
  await expect(globalDrawer.getByText(/Unavailable/)).toHaveCount(0);
  await globalDrawer.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Configure lead" }).click();
  const workspace = page.getByRole("main", { name: "Lead" });
  await workspace.getByRole("tab", { name: "Model", exact: true }).click();
  const model = workspace.getByRole("combobox", { name: "Model" });
  await expect(model).toHaveValue("gpt-5.5");
  await expect(model.locator("option", { hasText: "Unavailable — gpt-5.5" })).toHaveCount(1);
  await workspace.getByRole("tab", { name: "Profile", exact: true }).click();
  await workspace.getByLabel("Title").fill("Principal");
  await expect.poll(() => writes).toContainEqual({ details: { title: "Principal", description: "Project lead" } });
  await workspace.getByRole("tab", { name: "Model", exact: true }).click();
  await model.selectOption("");
  await expect.poll(() => writes).toContainEqual({ model: {} });
});

test("a ready catalog marks only a proven missing override unavailable", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const projects = await response.json() as Array<Record<string, unknown>>;
  const lead = ((projects[0].agents as Array<Record<string, unknown>>).find((agent) => agent.id === "lead"))!;
  lead.model = "retired-model";
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route("**/api/settings", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        defaultModel: "gpt-5.4-mini",
        models: [{ id: "gpt-5.4-mini", name: "GPT-5.4 mini" }],
        catalog: { status: "ready" },
      }),
    });
  });
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    writes.push(request.postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Configure lead" }).click();
  const workspace = page.getByRole("main", { name: "Lead" });
  await workspace.getByRole("tab", { name: "Model", exact: true }).click();
  const model = workspace.getByRole("combobox", { name: "Model" });
  await expect(model).toHaveValue("retired-model");
  await expect(model.locator("option", { hasText: "Unavailable — retired-model" })).toHaveCount(1);
  await model.selectOption("");
  await expect.poll(() => writes).toContainEqual({ model: {} });
  await expect(model).toHaveValue("");
  await expect(model.locator("option").first()).toHaveText("Default — GPT-5.4 mini");
});

test("agent title and description edit without renaming its stable id", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const projects = await response.json() as Array<Record<string, unknown>>;
  const lead = ((projects[0].agents as Array<Record<string, unknown>>).find((agent) => agent.id === "lead"))!;
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    saved = request.postDataJSON() as Record<string, unknown>;
    const details = saved.details as Record<string, unknown>;
    lead.title = details.title;
    lead.role = details.description;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Principal Developer");
  await page.getByRole("textbox", { name: "Description" }).fill("Owns delivery");
  await expect.poll(() => saved).toEqual({
    details: {
      title: "Principal Developer",
      description: "Owns delivery",
    },
  });
  await expect(page.getByRole("main").getByRole("heading", { name: "Principal Developer", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("Owns delivery", { exact: true })).toHaveCount(0);
});

test("agent drawers stay scoped when projects share an agent id", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [base] = await response.json() as Array<Record<string, unknown>>;
  const project = (id: string, name: string, title: string, role: string) => ({
    ...base,
    id,
    name,
    root: `C:\\Projects\\${id}`,
    agents: (base.agents as Array<Record<string, unknown>>).map((agent) =>
      agent.id === "lead" ? { ...agent, title, role } : agent),
  });
  const projects = [
    project("drawer-project-a", "Drawer project A", "Lead A", "Owns project A"),
    project("drawer-project-b", "Drawer project B", "Lead B", "Owns project B"),
  ];
  const messagePosts: string[] = [];
  const messageLoads: string[] = [];
  const agentWrites: Array<{ projectId: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route(/\/api\/projects\/drawer-project-[ab]\/messages(?:\?.*)?$/, async (route, request) => {
    const projectId = request.url().includes("drawer-project-a") ? "drawer-project-a" : "drawer-project-b";
    if (request.method() === "POST") {
      messagePosts.push(projectId);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    messageLoads.push(projectId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          id: `message-${projectId}`,
          sender: "lead",
          recipient: "dashboard",
          body: `Loaded ${projectId}`,
          status: "completed",
          timestamp: "2026-07-15T12:00:00Z",
          direction: "incoming",
          kind: "assistant",
        }],
        hasMore: false,
      }),
    });
  });
  await page.route(/\/api\/projects\/drawer-project-[ab]\/agents\/lead$/, async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    const projectId = request.url().includes("drawer-project-a") ? "drawer-project-a" : "drawer-project-b";
    const body = request.postDataJSON() as Record<string, unknown>;
    agentWrites.push({ projectId, body });
    const target = projects.find((item) => item.id === projectId)!;
    const lead = (target.agents as Array<Record<string, unknown>>).find((agent) => agent.id === "lead")!;
    const details = body.details as Record<string, unknown>;
    lead.title = details.title;
    lead.role = details.description;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  let drawer = page.getByRole("dialog", { name: /^Conversation with / });
  await expect(drawer.getByText("Loaded drawer-project-a", { exact: true })).toBeVisible();
  await drawer.getByRole("textbox", { name: "Message lead" }).fill("Unsaved project A message");
  await page.locator('[data-project-selection="drawer-project-b"]').evaluate((button: HTMLElement) => button.click());
  await expect(page.getByRole("heading", { name: "Drawer project B" })).toBeVisible();
  await expect(drawer).toHaveCount(0);
  expect(messagePosts).toEqual([]);

  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  drawer = page.getByRole("dialog", { name: /^Conversation with / });
  await expect(drawer.getByText("Loaded drawer-project-b", { exact: true })).toBeVisible();
  expect(messageLoads).toContain("drawer-project-b");
  await drawer.getByRole("textbox", { name: "Message lead" }).fill("Explicit project B message");
  await drawer.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => messagePosts).toEqual(["drawer-project-b"]);
  await drawer.getByRole("button", { name: "Close" }).click();

  await page.locator('[data-project-selection="drawer-project-a"]').click();
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue("Lead A");
  await page.getByLabel("Lead A color").fill("#123456");
  await title.fill("Unsaved Lead A");
  await page.locator('[data-project-selection="drawer-project-b"]').evaluate((button: HTMLElement) => button.click());
  await expect(page.getByRole("heading", { name: "Drawer project B" })).toBeVisible();
  await expect(title).toHaveCount(0);
  expect(agentWrites).toEqual([{
    projectId: "drawer-project-a",
    body: { details: { title: "Unsaved Lead A", description: "Owns project A" } },
  }]);
  const storedColors = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("harness-agent-colors") || "{}") as Record<string, string>);
  expect(storedColors[JSON.stringify(["drawer-project-a", "lead"])]).toBe("#123456");
  expect(storedColors[JSON.stringify(["drawer-project-b", "lead"])]).toBeUndefined();

  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Lead B");
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("Owns project B");
  await page.getByRole("textbox", { name: "Title" }).fill("Explicit Lead B");
  await expect.poll(() => agentWrites).toEqual([
    {
      projectId: "drawer-project-a",
      body: { details: { title: "Unsaved Lead A", description: "Owns project A" } },
    },
    {
      projectId: "drawer-project-b",
      body: { details: { title: "Explicit Lead B", description: "Owns project B" } },
    },
  ]);
});

test("selected project remains usable when its storage access fails", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [first] = await response.json() as Array<Record<string, unknown>>;
  const second = { ...first, id: "secondary-project", name: "Secondary project" };
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.addInitScript(() => {
    const state = window as typeof window & {
      failSelectedProjectRead: boolean;
      failSelectedProjectWrite: boolean;
      projectChangeEvents: number;
    };
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    state.failSelectedProjectRead = true;
    state.failSelectedProjectWrite = true;
    state.projectChangeEvents = 0;
    window.addEventListener("harness-project-change", () => { state.projectChangeEvents += 1; });
    Storage.prototype.getItem = function(storageKey) {
      if (storageKey === "harness-selected-project" && state.failSelectedProjectRead) {
        throw new DOMException("Selected project storage is unavailable", "SecurityError");
      }
      return getItem.call(this, storageKey);
    };
    Storage.prototype.setItem = function(storageKey, value) {
      if (storageKey === "harness-selected-project" && state.failSelectedProjectWrite) {
        throw new DOMException("Selected project storage is unavailable", "SecurityError");
      }
      return setItem.call(this, storageKey, value);
    };
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([first, second]) });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: String(first.name) })).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { failSelectedProjectRead: boolean }).failSelectedProjectRead = false;
  });
  await page.locator('[data-project-selection="secondary-project"]').click();
  await expect(page.getByRole("heading", { name: "Secondary project" })).toBeVisible();

  await page.evaluate(() => {
    const state = window as typeof window & { failSelectedProjectWrite: boolean; projectChangeEvents: number };
    state.failSelectedProjectWrite = false;
    state.projectChangeEvents = 0;
  });
  await page.locator(`[data-project-selection="${String(first.id)}"]`).click();
  await expect(page.getByRole("heading", { name: String(first.name) })).toBeVisible();
  expect(await page.evaluate(() => ({
    selected: localStorage.getItem("harness-selected-project"),
    events: (window as typeof window & { projectChangeEvents: number }).projectChangeEvents,
  }))).toEqual({ selected: first.id, events: 1 });
  expect(pageErrors).toEqual([]);
});

test("dashboard coalesces project event refresh bursts with one trailing refresh", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const intermediateProject = { ...baseProject, name: "Intermediate event state" };
  const finalProject = { ...baseProject, name: "Final event state" };
  let refreshing = false;
  let projectRequests = 0;
  let healthRequests = 0;
  let firstProjectStarted!: () => void;
  let firstHealthStarted!: () => void;
  let secondProjectStarted!: () => void;
  let secondHealthStarted!: () => void;
  let releaseProject!: () => void;
  let releaseHealth!: () => void;
  const firstProjectRequest = new Promise<void>((resolve) => { firstProjectStarted = resolve; });
  const firstHealthRequest = new Promise<void>((resolve) => { firstHealthStarted = resolve; });
  const secondProjectRequest = new Promise<void>((resolve) => { secondProjectStarted = resolve; });
  const secondHealthRequest = new Promise<void>((resolve) => { secondHealthStarted = resolve; });
  const projectPending = new Promise<void>((resolve) => { releaseProject = resolve; });
  const healthPending = new Promise<void>((resolve) => { releaseHealth = resolve; });
  let projectStartedAt = 0;
  let healthStartedAt = 0;
  let initialProjectLoaded!: () => void;
  let initialHealthLoaded!: () => void;
  const initialProjectRequest = new Promise<void>((resolve) => { initialProjectLoaded = resolve; });
  const initialHealthRequest = new Promise<void>((resolve) => { initialHealthLoaded = resolve; });
  await page.addInitScript(() => {
    const sources: Array<{ onmessage: ((event: MessageEvent<string>) => void) | null }> = [];
    class MockEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      constructor() { sources.push(this); }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
    (window as typeof window & { emitProjectEvents: (count: number) => void }).emitProjectEvents = (count) => {
      for (let index = 0; index < count; index += 1) {
        const message = new MessageEvent("message", { data: JSON.stringify({ projectId: "event-project", conversations: [] }) });
        for (const source of sources) source.onmessage?.(message);
      }
    };
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    if (!refreshing) {
      await route.continue();
      initialProjectLoaded();
      return;
    }
    projectRequests += 1;
    if (projectRequests === 1) {
      projectStartedAt = Date.now();
      firstProjectStarted();
      await projectPending;
    } else {
      secondProjectStarted();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([projectRequests === 1 ? intermediateProject : finalProject]),
    });
  });
  await page.route("**/api/health", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    if (!refreshing) {
      await route.continue();
      initialHealthLoaded();
      return;
    }
    healthRequests += 1;
    if (healthRequests === 1) {
      healthStartedAt = Date.now();
      firstHealthStarted();
      await healthPending;
    } else {
      secondHealthStarted();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "healthy", label: `Event health ${healthRequests}`, issues: [] }),
    });
  });

  await page.goto("/");
  await Promise.all([initialProjectRequest, initialHealthRequest]);
  await expect(page.getByRole("heading", { name: String(baseProject.name) })).toBeVisible();
  refreshing = true;
  const emittedAt = Date.now();
  await page.evaluate(() => (window as typeof window & { emitProjectEvents: (count: number) => void }).emitProjectEvents(20));
  await Promise.all([firstProjectRequest, firstHealthRequest]);
  expect(projectRequests).toBe(1);
  expect(healthRequests).toBe(1);
  expect(projectStartedAt - emittedAt).toBeLessThanOrEqual(250);
  expect(healthStartedAt - emittedAt).toBeLessThanOrEqual(250);

  await page.evaluate(() => (window as typeof window & { emitProjectEvents: (count: number) => void }).emitProjectEvents(20));
  expect(projectRequests).toBe(1);
  expect(healthRequests).toBe(1);
  releaseProject();
  releaseHealth();
  await Promise.all([secondProjectRequest, secondHealthRequest]);
  await expect(page.getByRole("heading", { name: "Final event state" })).toBeVisible();
  expect(projectRequests).toBe(2);
  expect(healthRequests).toBe(2);
});

test("dashboard falls back when live events fail and recovers when delivery resumes", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const fallbackProject = { ...baseProject, name: "Fallback refreshed state" };
  let changed = false;
  let changedRequests = 0;
  await page.addInitScript(() => {
    type MockSource = {
      onmessage: ((event: MessageEvent<string>) => void) | null;
      onerror: ((event: Event) => void) | null;
    };
    const sources: MockSource[] = [];
    class MockEventSource implements MockSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor() {
        sources.push(this);
        queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: "ready" })));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
    const controls = window as typeof window & {
      failProjectEvents: () => void;
      degradeProjectWatching: () => void;
      recoverProjectEvents: () => void;
      emitProjectEvents: (count: number) => void;
    };
    controls.failProjectEvents = () => {
      for (const source of sources) source.onerror?.(new Event("error"));
    };
    controls.degradeProjectWatching = () => {
      for (const source of sources) source.onmessage?.(new MessageEvent("message", { data: "degraded" }));
    };
    controls.recoverProjectEvents = () => {
      for (const source of sources) source.onmessage?.(new MessageEvent("message", { data: "ready" }));
    };
    controls.emitProjectEvents = (count) => {
      for (let index = 0; index < count; index += 1) {
        const message = new MessageEvent("message", {
          data: JSON.stringify({ projectId: "fallback-project", conversations: [] }),
        });
        for (const source of sources) source.onmessage?.(message);
      }
    };
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    if (changed) changedRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([changed ? fallbackProject : baseProject]),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: String(baseProject.name) })).toBeVisible();
  await page.evaluate(() => (window as typeof window & { failProjectEvents: () => void }).failProjectEvents());
  const degradedWarning = page.getByText("Live updates unavailable. Refreshing periodically.", { exact: true });
  await expect(degradedWarning).toBeVisible();
  changed = true;
  await expect(page.getByRole("heading", { name: "Fallback refreshed state" })).toBeVisible({ timeout: 5_000 });
  expect(changedRequests).toBeLessThanOrEqual(2);

  await page.evaluate(() => (window as typeof window & { recoverProjectEvents: () => void }).recoverProjectEvents());
  await expect(degradedWarning).toBeHidden();
  const requestsBeforeBurst = changedRequests;
  await page.evaluate(() => (window as typeof window & { emitProjectEvents: (count: number) => void }).emitProjectEvents(20));
  await expect.poll(() => changedRequests).toBe(requestsBeforeBurst + 1);

  await page.evaluate(() => (window as typeof window & { degradeProjectWatching: () => void }).degradeProjectWatching());
  await expect(degradedWarning).toBeVisible();
  await page.evaluate(() => (window as typeof window & { emitProjectEvents: (count: number) => void }).emitProjectEvents(1));
  await expect(degradedWarning).toBeVisible();
  await page.evaluate(() => (window as typeof window & { recoverProjectEvents: () => void }).recoverProjectEvents());
  await expect(degradedWarning).toBeHidden();
});

test("automation modal keyboard focus", async ({ page }) => {
  await page.goto("/");
  const automation = page.getByText("Automatic work", { exact: true }).locator("..").locator("..");
  await automation.getByRole("button").click();

  const dialog = page.getByRole("dialog", { name: "Automatic work" });
  const close = dialog.getByRole("button", { name: "Close" });
  const producer = dialog.getByRole("combobox", { name: "Creation agent" });
  const prompt = dialog.getByRole("textbox", { name: "What should it create?" });
  const minimum = dialog.getByRole("spinbutton", { name: "Minimum active automatic tasks" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const save = dialog.getByRole("button", { name: "Save" });

  await expect(producer).toBeFocused();
  await producer.selectOption("");
  await expect(prompt).toBeDisabled();
  await expect(minimum).toBeDisabled();

  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();

  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
});

test("automation settings are scoped to the project that opened them", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const projectA = {
    ...baseProject,
    id: "automation-project-a",
    name: "Automation project A",
    producerId: "lead",
    producerLimit: 2,
    producerPrompt: "Project A automatic work",
  };
  const projectB = {
    ...baseProject,
    id: "automation-project-b",
    name: "Automation project B",
    producerId: "builder",
    producerLimit: 7,
    producerPrompt: "Project B automatic work",
  };
  const saves: Array<{ url: string; body: unknown }> = [];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([projectA, projectB]),
    });
  });
  await page.route("**/api/projects/*/automation", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    saves.push({ url: request.url(), body: request.postDataJSON() });
    return route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Automation project A" })).toBeVisible();
  await page.getByText("Automatic work", { exact: true }).locator("..").locator("..").getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Automatic work" });
  await expect(dialog.getByRole("combobox", { name: "Creation agent" })).toHaveValue("lead");
  await dialog.getByRole("textbox", { name: "What should it create?" }).fill("Unsaved project A automatic work");

  await page.locator('[data-project-selection="automation-project-b"]').evaluate((button: HTMLElement) => button.click());
  await expect(page.getByRole("heading", { name: "Automation project B" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByText("Automatic work", { exact: true }).locator("..").locator("..").getByRole("button").click();
  const projectBDialog = page.getByRole("dialog", { name: "Automatic work" });
  await expect(projectBDialog.getByRole("combobox", { name: "Creation agent" })).toHaveValue("builder");
  await expect(projectBDialog.getByRole("spinbutton", { name: "Minimum active automatic tasks" })).toHaveValue("7");
  await expect(projectBDialog.getByRole("textbox", { name: "What should it create?" })).toHaveValue("Project B automatic work");
  await projectBDialog.getByRole("button", { name: "Save" }).click();
  await expect(projectBDialog).toHaveCount(0);

  expect(saves).toEqual([{
    url: expect.stringContaining("/api/projects/automation-project-b/automation"),
    body: { producer: "builder", limit: 7, prompt: "Project B automatic work" },
  }]);
});

test("Automatic work card reports runtime state", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const baseline = await response.json() as Array<Record<string, unknown>>;
  const baseProject = baseline[0];
  const agents = baseProject.agents as Array<Record<string, unknown>>;
  const producer = agents[0];
  let project = { ...baseProject, producerId: undefined };

  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ ...project }]),
    });
  });

  const card = page.getByText("Automatic work", { exact: true }).locator("..").locator("..");
  const show = async (next: Record<string, unknown>) => {
    project = { ...baseProject, ...next };
    await page.goto("/");
    await expect(card).toBeVisible();
  };

  await show({ producerId: undefined });
  await expect(card).toContainText("Create the next task when the queue is empty.");
  await expect(card.getByRole("button")).toHaveText("Set up");

  await show({ producerId: producer.id, producerLimit: undefined, generatedWorkCount: 1 });
  await expect(card).toContainText(`${producer.id} · 1 active automatic task · minimum 1`);
  await expect(card).not.toContainText("undefined");
  await expect(card.getByRole("button")).toHaveText("Manage");

  await show({ producerId: producer.id, producerLimit: 4, generatedWorkCount: 2 });
  await expect(card).toContainText(`${producer.id} · 2 active automatic tasks · minimum 4`);

  await show({ producerId: producer.id, paused: true });
  await expect(card).toContainText("Automatic work is paused with the project.");
  await expect(card.getByRole("button")).toHaveText("Manage");

  await show({
    producerId: producer.id,
    agents: agents.map((agent) => agent.id === producer.id ? { ...agent, status: "paused" } : agent),
  });
  await expect(card).toContainText(`${producer.id} must be resumed before automatic work can continue.`);
  await expect(card.getByRole("button")).toHaveText("Manage");

  await show({ producerId: "missing-producer" });
  await expect(card).toContainText('Configured creation agent "missing-producer" is unavailable.');
  await expect(card).not.toContainText("Create the next task when the queue is empty.");
  await expect(card.getByRole("button")).toHaveText("Manage");
});

test("project header preserves the full workspace path", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const baseline = await response.json() as Array<Record<string, unknown>>;
  let root = "";
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const projects = baseline.map((project, index) => index === 0 ? { ...project, root } : project);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  const scenarios = [
    { width: 1024, root: "/Users/product/Workspaces/client-delivery/very-long-program-name/apps/operator-dashboard" },
    { width: 800, root: "C:\\Users\\operator\\Documents\\GitHub\\enterprise-platform\\packages\\operator-dashboard" },
    { width: 390, root: "\\\\server\\department\\shared workspaces\\long customer program\\operator dashboard" },
    { width: 1024, root: "/" },
    { width: 390, root: "C:\\" },
  ];
  let ellipsized = false;

  for (const scenario of scenarios) {
    root = scenario.root;
    await page.setViewportSize({ width: scenario.width, height: 844 });
    const projectsLoaded = page.waitForResponse((apiResponse) => apiResponse.url().endsWith("/api/projects") && apiResponse.request().method() === "GET");
    await page.goto("/");
    await projectsLoaded;
    const workspacePath = page.getByTitle(root, { exact: true });
    await expect(workspacePath).toBeVisible();
    expect(await workspacePath.textContent()).toBe(root);
    await expect(workspacePath).toHaveAttribute("title", root);
    await expect(workspacePath).not.toHaveAttribute("aria-label");
    await expect(page.getByRole("heading", { name: "Persona test" })).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText("Releases", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New task" })).toBeEnabled();
    const clipped = await workspacePath.evaluate((node) => node.scrollWidth > node.clientWidth);
    ellipsized ||= clipped;
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

    await workspacePath.focus();
    await expect(workspacePath).toBeFocused();
    expect(await workspacePath.textContent()).toBe(root);
    const focused = await workspacePath.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, whiteSpace: getComputedStyle(node).whiteSpace };
    });
    expect(focused.whiteSpace).toBe("normal");
    expect(focused.left).toBeGreaterThanOrEqual(0);
    expect(focused.right).toBeLessThanOrEqual(scenario.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }

  expect(ellipsized).toBe(true);
  await page.getByRole("button", { name: "New task" }).click();
  await expect(page.getByRole("textbox", { name: "Task document" })).toBeFocused();
});

test("budget exhausted agents show attention status", async ({ page }) => {
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  const db = new DatabaseSync(dbPath);
  const original = db.prepare("SELECT status FROM agents WHERE agent_id='builder'").get() as { status: string };
  db.prepare("UPDATE agents SET status='budget-exhausted' WHERE agent_id='builder'").run();
  db.close();

  try {
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Open conversation with builder" });
    const card = opener.locator("..");
    await expect(card.getByText("Budget exhausted", { exact: true })).toBeVisible();
    await opener.click();
    const conversation = page.getByRole("dialog", { name: /^Conversation with / });
    await expect(conversation.getByText("Budget exhausted", { exact: true })).toBeVisible();
  } finally {
    const cleanup = new DatabaseSync(dbPath);
    cleanup.prepare("UPDATE agents SET status=? WHERE agent_id='builder'").run(original.status);
    cleanup.close();
  }
});

test("activity rows encode essential status in concise copy", async ({ page }) => {
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  const db = new DatabaseSync(dbPath);
  db.prepare(`INSERT INTO turns VALUES
    (3,'builder','failed',?,'2026-07-13T12:03:00Z'),
    (4,'lead','waiting',?,'2026-07-13T12:04:00Z')`)
    .run(
      '{"summary":"Bounded turn stopped.","deliverable":null}',
      '{"summary":"Delegated: Keep the dashboard fresh","deliverable":null}',
    );
  db.close();

  try {
    await page.goto("/");
    const completed = page.getByRole("button", { name: /Delegated launch work.*lead/i });
    const delegated = page.getByRole("button", { name: /Delegated Keep the dashboard fresh.*lead/i });
    const failed = page.getByRole("button", { name: /Failed: Bounded turn stopped.*builder/i });
    await expect(completed).toBeVisible();
    await expect(delegated).toBeVisible();
    await expect(failed).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Recent activity" }).locator('[data-display="dot"]')).toHaveCount(0);

    await completed.click();
    await expect(page.getByRole("dialog", { name: /^Conversation with / })).toBeVisible();
  } finally {
    const cleanup = new DatabaseSync(dbPath);
    cleanup.prepare("DELETE FROM turns WHERE sequence IN (3,4)").run();
    cleanup.close();
  }
});

test("recent activity clearing is keyboard-contained and restores focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Clear recent activity" });
  await trigger.focus();
  await trigger.press("Enter");

  let confirmation = page.getByRole("alertdialog", { name: "Hide current activity?" });
  const cancel = confirmation.getByRole("button", { name: "Cancel" });
  const clear = confirmation.getByRole("button", { name: "Clear" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(clear).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  confirmation = page.getByRole("alertdialog", { name: "Hide current activity?" });
  await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "Clear" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText("No recent updates", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Delegated launch work/ })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-disabled", "true");
});

test("tablet keeps recent activity accessible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Project workspace" }).getByRole("button", { name: "Recent activity" }).click();

  const activity = page.getByRole("complementary", { name: "Recent activity" });
  await expect(activity.getByText("Recent activity", { exact: true })).toBeVisible();
  await activity.getByRole("button", { name: /Delegated launch work.*lead/i }).click();

  const conversation = page.getByRole("dialog", { name: /^Conversation with / });
  await expect(conversation.getByLabel("Conversation history with lead")).toBeVisible();
  await expect(conversation.locator('[data-chat-id="turn:1"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test("wide dashboard rails resize by pointer and physical-boundary keyboard controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const projectRail = page.getByRole("complementary", { name: "Project navigation" });
  const activityRail = page.getByRole("complementary", { name: "Recent activity" });
  const projectSplitter = page.getByRole("separator", { name: "Resize project navigation" });
  const activitySplitter = page.getByRole("separator", { name: "Resize recent activity" });
  const workbench = page.getByRole("region", { name: "Draft workbench" });
  await expect(projectSplitter).toHaveAttribute("aria-controls", "project-navigation-rail");
  await expect(activitySplitter).toHaveAttribute("aria-controls", "recent-activity-rail");
  await expect(projectSplitter).toHaveAttribute("aria-valuemin", "180");
  await expect(activitySplitter).toHaveAttribute("aria-valuemin", "240");
  await expect(projectRail).toHaveJSProperty("id", "project-navigation-rail");
  await expect(activityRail).toHaveJSProperty("id", "recent-activity-rail");
  expect(await projectRail.evaluate((node) => node.getBoundingClientRect().width)).toBe(220);
  expect(await activityRail.evaluate((node) => node.getBoundingClientRect().width)).toBe(280);
  const initialWorkbenchHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);

  const projectBox = await projectSplitter.boundingBox();
  expect(projectBox).not.toBeNull();
  expect(projectBox!.width).toBe(24);
  expect(await projectSplitter.evaluate((node) => ({
    touchAction: getComputedStyle(node).touchAction,
    lineWidth: getComputedStyle(node, "::after").width,
  }))).toEqual({ touchAction: "none", lineWidth: "1px" });
  await page.mouse.move(projectBox!.x + projectBox!.width / 2, projectBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(projectBox!.x + projectBox!.width / 2 + 48, projectBox!.y + 80);
  await page.mouse.up();
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "268");
  expect(await projectRail.evaluate((node) => node.getBoundingClientRect().width)).toBe(268);

  await projectSplitter.press("ArrowRight");
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "276");
  await projectSplitter.press("Shift+ArrowLeft");
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "244");
  await activitySplitter.press("ArrowLeft");
  await expect(activitySplitter).toHaveAttribute("aria-valuenow", "288");
  await activitySplitter.press("Shift+ArrowRight");
  await expect(activitySplitter).toHaveAttribute("aria-valuenow", "256");

  const cancelBox = await projectSplitter.boundingBox();
  await page.mouse.move(cancelBox!.x + cancelBox!.width / 2, cancelBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(cancelBox!.x + cancelBox!.width / 2 + 40, cancelBox!.y + 80);
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "284");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "244");

  await projectSplitter.evaluate((node) => {
    node.addEventListener("pointerdown", (event) => {
      node.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId));
    }, { once: true });
  });
  const pointerCancelBox = await projectSplitter.boundingBox();
  await page.mouse.move(pointerCancelBox!.x + pointerCancelBox!.width / 2, pointerCancelBox!.y + 80);
  await page.mouse.down();
  await projectSplitter.dispatchEvent("pointermove", {
    pointerId: 99,
    isPrimary: true,
    clientX: pointerCancelBox!.x + 80,
  });
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "244");
  await page.mouse.move(pointerCancelBox!.x + pointerCancelBox!.width / 2 + 24, pointerCancelBox!.y + 80);
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "268");
  const pointerId = Number(await projectSplitter.getAttribute("data-test-pointer-id"));
  await projectSplitter.dispatchEvent("pointercancel", { pointerId, isPrimary: true });
  await page.mouse.up();
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "244");

  await projectSplitter.dispatchEvent("pointerdown", {
    pointerId: 37,
    isPrimary: false,
    button: 0,
    clientX: pointerCancelBox!.x,
  });
  await projectSplitter.dispatchEvent("pointermove", {
    pointerId: 37,
    isPrimary: false,
    clientX: pointerCancelBox!.x + 80,
  });
  await projectSplitter.dispatchEvent("pointerup", { pointerId: 37, isPrimary: false });
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "244");

  await projectSplitter.dblclick();
  await expect(projectSplitter).toHaveAttribute("aria-valuenow", "220");
  await expect(activitySplitter).toHaveAttribute("aria-valuenow", "256");
  await activitySplitter.press("Home");
  await expect(activitySplitter).toHaveAttribute("aria-valuenow", "240");
  await activitySplitter.press("End");
  await expect(activitySplitter).toHaveAttribute("aria-valuenow", "480");

  const stored = await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("harness-dashboard-layouts") || "{}") as Record<string, string>;
    return JSON.parse(records["operations-dashboard"]);
  }) as {
    version: number;
    preset: string;
    projectNav: { preferredWidth: number; visible: boolean };
    activity: { preferredWidth: number; visible: boolean };
  };
  expect(stored).toEqual({
    version: 1,
    preset: "custom",
    projectNav: { preferredWidth: 220, visible: true },
    activity: { preferredWidth: 480, visible: true },
  });

  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize project navigation" })).toHaveAttribute("aria-valuenow", "220");
  await expect(page.getByRole("separator", { name: "Resize recent activity" })).toHaveAttribute("aria-valuenow", "480");
  const geometry = await page.evaluate(() => {
    const project = document.getElementById("project-navigation-rail")!.getBoundingClientRect();
    const activity = document.getElementById("recent-activity-rail")!.getBoundingClientRect();
    const draft = document.querySelector<HTMLElement>('[aria-label="Draft workbench"]')!.getBoundingClientRect();
    const main = document.querySelector("main")!.getBoundingClientRect();
    return {
      projectRight: project.right,
      activityLeft: activity.left,
      draftLeft: draft.left,
      draftRight: draft.right,
      center: (project.right + activity.left) / 2,
      mainCenter: (main.left + main.right) / 2,
      workbenchHeight: draft.height,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(Math.abs(geometry.projectRight - geometry.draftLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.activityLeft - geometry.draftRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.center - geometry.mainCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.workbenchHeight - initialWorkbenchHeight)).toBeLessThanOrEqual(1);
  expect(geometry.overflow).toBeLessThanOrEqual(0);
});

test("wide dashboard clamps effective rails without overwriting preferred widths", async ({ page }) => {
  const storedLayout = JSON.stringify({
    version: 1,
    preset: "custom",
    projectNav: { preferredWidth: 360, visible: true },
    activity: { preferredWidth: 480, visible: true },
  });
  await page.addInitScript((layout) => {
    localStorage.setItem("harness-dashboard-layouts", JSON.stringify({ "operations-dashboard": layout }));
  }, storedLayout);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/");

  const projectRail = page.getByRole("complementary", { name: "Project navigation" });
  const activityRail = page.getByRole("complementary", { name: "Recent activity" });
  await expect(page.getByRole("separator", { name: "Resize project navigation" })).toBeVisible();
  const constrained = {
    project: await projectRail.evaluate((node) => node.getBoundingClientRect().width),
    activity: await activityRail.evaluate((node) => node.getBoundingClientRect().width),
  };
  expect(constrained.project + constrained.activity).toBe(620);
  expect(1100 - constrained.project - constrained.activity).toBeGreaterThanOrEqual(480);
  expect(await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("harness-dashboard-layouts") || "{}") as Record<string, string>;
    return records["operations-dashboard"];
  })).toBe(storedLayout);

  await page.setViewportSize({ width: 1600, height: 800 });
  await expect.poll(() => projectRail.evaluate((node) => node.getBoundingClientRect().width)).toBe(360);
  await expect.poll(() => activityRail.evaluate((node) => node.getBoundingClientRect().width)).toBe(480);
  expect(await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("harness-dashboard-layouts") || "{}") as Record<string, string>;
    return records["operations-dashboard"];
  })).toBe(storedLayout);
});

test("saved dashboard geometry is stable from first observed layout through hydration", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [project] = await response.json() as Array<{ id: string }>;
  const layout = JSON.stringify({
    version: 1,
    preset: "custom",
    projectNav: { preferredWidth: 340, visible: true },
    activity: { preferredWidth: 420, visible: true },
  });
  const draftHeights = JSON.stringify({ [project.id]: 600 });
  await page.context().addCookies([
    { name: "harness-selected-project", value: project.id, domain: "127.0.0.1", path: "/", sameSite: "Lax" },
    { name: "harness-dashboard-layout", value: encodeURIComponent(layout), domain: "127.0.0.1", path: "/", sameSite: "Lax" },
    { name: "harness-draft-heights", value: encodeURIComponent(draftHeights), domain: "127.0.0.1", path: "/", sameSite: "Lax" },
  ]);
  await page.addInitScript(({ projectId, storedLayout }) => {
    localStorage.setItem("harness-selected-project", projectId);
    localStorage.setItem("harness-dashboard-layouts", JSON.stringify({ "operations-dashboard": storedLayout }));
    localStorage.setItem("harness-draft-workspaces", JSON.stringify({
      [projectId]: JSON.stringify({ openIds: ["existing"], activeId: "existing", height: 600 }),
    }));
    const target = window as typeof window & { __dashboardLayoutShift?: number };
    target.__dashboardLayoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
          target.__dashboardLayoutShift! += (entry as PerformanceEntry & { value: number }).value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  }, { projectId: project.id, storedLayout: layout });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("separator", { name: "Resize project navigation" })).toHaveAttribute("aria-valuenow", "340");
  await expect(page.getByRole("separator", { name: "Resize recent activity" })).toHaveAttribute("aria-valuenow", "420");
  await expect(page.getByRole("region", { name: "Draft workbench" })).toHaveCSS("height", "600px");

  await page.waitForTimeout(250);
  expect(await page.evaluate(() =>
    (window as typeof window & { __dashboardLayoutShift?: number }).__dashboardLayoutShift || 0,
  )).toBe(0);
});

test("invalid dashboard layout storage falls back without corrective writes", async ({ page }) => {
  const invalidLayout = '{"version":2,"preset":"custom","projectNav":{"preferredWidth":999,"visible":true}}';
  await page.addInitScript((layout) => {
    localStorage.setItem("harness-dashboard-layouts", JSON.stringify({ "operations-dashboard": layout }));
  }, invalidLayout);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("separator", { name: "Resize project navigation" })).toHaveAttribute("aria-valuenow", "220");
  await expect(page.getByRole("separator", { name: "Resize recent activity" })).toHaveAttribute("aria-valuenow", "280");
  expect(await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("harness-dashboard-layouts") || "{}") as Record<string, string>;
    return records["operations-dashboard"];
  })).toBe(invalidLayout);
});

test("dashboard rail splitters stay out of compact layouts", async ({ page }) => {
  for (const width of [1050, 720, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("separator", { name: /Resize (project navigation|recent activity)/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    if (width > 720) {
      expect(await page.getByRole("complementary", { name: "Project navigation" }).evaluate((node) => node.getBoundingClientRect().width)).toBe(200);
    }
  }
  await page.setViewportSize({ width: 1051, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("separator", { name: "Resize project navigation" })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize recent activity" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("dashboard preserves its last good data when refresh fails", async ({ page }) => {
  const projectsResponse = await page.request.get("/api/projects");
  const projects = await projectsResponse.json() as Array<Record<string, unknown>>;
  const initialProjects = projects.map((project, index) => ({
    ...project,
    name: index === 0 ? "Initial refresh project" : project.name,
  }));
  const recoveredProjects = initialProjects.map((project, index) => ({
    ...project,
    name: index === 0 ? "Recovered refresh project" : project.name,
  }));
  const initialHealth = {
    status: "attention",
    label: "Initial health snapshot",
    issues: [{
      projectId: initialProjects[0].id,
      projectName: "Initial refresh project",
      summary: "Last known worker issue",
      transcript: "Last successful health details",
    }],
  };
  const recoveredHealth = { status: "healthy", label: "Recovered health snapshot", issues: [] };
  const pageErrors: Error[] = [];
  let state: "initial" | "failed" | "recovered" = "initial";
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    if (state === "failed") {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Project refresh temporarily unavailable."}',
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state === "recovered" ? recoveredProjects : initialProjects),
    });
  });
  await page.route("**/api/health", async (route, request) => {
    if (request.method() === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    if (request.method() !== "GET") return route.continue();
    if (state === "failed") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state === "recovered" ? recoveredHealth : initialHealth),
    });
  });

  await page.goto("/");
  const initialProject = page.getByRole("button", { name: /Initial refresh project.*tasks/ });
  await expect(initialProject).toBeVisible();
  await initialProject.click();
  await expect(page.getByRole("heading", { name: "Initial refresh project" })).toBeVisible();
  const healthButton = page.getByRole("button", { name: "Initial health snapshot" });
  await expect(healthButton).toBeVisible();
  await healthButton.click();

  state = "failed";
  await page.getByRole("button", { name: "Restart agents" }).click();
  const alert = page.locator("p[role='alert']");
  await expect(alert).toContainText("Project refresh temporarily unavailable.");
  await expect(alert).toContainText("Could not refresh system status");
  await expect(initialProject).toBeVisible();
  await expect(page.getByRole("heading", { name: "Initial refresh project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Initial health snapshot" })).toBeVisible();
  expect(pageErrors).toEqual([]);
  state = "recovered";
  await page.getByRole("button", { name: "Restart agents" }).click();
  await expect(page.getByRole("button", { name: /Recovered refresh project.*tasks/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recovered refresh project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recovered health snapshot" })).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("failed agent restart is retryable and single-flight", async ({ page }) => {
  const health = {
    status: "attention",
    label: "Restart recovery status",
    issues: [
      { projectId: "project-a", projectName: "Project A", summary: "Agent stopped", transcript: "Project A worker exited" },
      { projectId: "project-b", projectName: "Project B", summary: "Agent stalled", transcript: "Project B worker stopped responding" },
    ],
  };
  const pageErrors: Error[] = [];
  const postCounts = new Map<string, number>();
  let healthGets = 0;
  let projectGets = 0;
  let releaseAFirst!: () => void;
  let releaseASecond!: () => void;
  let releaseB!: () => void;
  let markAFirstStarted!: () => void;
  let markASecondStarted!: () => void;
  let markBStarted!: () => void;
  const aFirstStarted = new Promise<void>((resolve) => { markAFirstStarted = resolve; });
  const aSecondStarted = new Promise<void>((resolve) => { markASecondStarted = resolve; });
  const bStarted = new Promise<void>((resolve) => { markBStarted = resolve; });
  const aFirstReleased = new Promise<void>((resolve) => { releaseAFirst = resolve; });
  const aSecondReleased = new Promise<void>((resolve) => { releaseASecond = resolve; });
  const bReleased = new Promise<void>((resolve) => { releaseB = resolve; });
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/api/projects", async (route, request) => {
    if (request.method() === "GET") projectGets += 1;
    await route.continue();
  });
  await page.route("**/api/health", async (route, request) => {
    if (request.method() === "GET") {
      healthGets += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health) });
    }
    const { projectId } = request.postDataJSON() as { projectId: string };
    const count = (postCounts.get(projectId) || 0) + 1;
    postCounts.set(projectId, count);
    if (projectId === "project-a" && count === 1) {
      markAFirstStarted();
      await aFirstReleased;
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Worker restart timed out"}' });
    }
    if (projectId === "project-a" && count === 2) {
      markASecondStarted();
      await aSecondReleased;
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    markBStarted();
    await bReleased;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Restart recovery status" }).click();
  const projectA = page.locator("section").filter({ has: page.getByText("Project A", { exact: true }) });
  const projectB = page.locator("section").filter({ has: page.getByText("Project B", { exact: true }) });
  let restartA = projectA.getByRole("button", { name: "Restart agents" });
  const restartB = projectB.getByRole("button", { name: "Restart agents" });

  await restartA.click();
  await aFirstStarted;
  const pendingA = projectA.getByRole("button", { name: "Restarting agents" });
  await expect(pendingA).toBeDisabled();
  await pendingA.evaluate((button) => button.click());
  await page.keyboard.press("Enter");
  expect(postCounts.get("project-a")).toBe(1);

  await expect(restartB).toBeEnabled();
  await restartB.click();
  await bStarted;
  await expect(projectB.getByRole("button", { name: "Restarting agents" })).toBeDisabled();
  expect(postCounts.get("project-b")).toBe(1);
  releaseB();
  await expect(projectB.getByRole("button", { name: "Restart agents" })).toBeEnabled();
  await expect(projectB.getByRole("alert")).toHaveCount(0);

  releaseAFirst();
  const alertA = projectA.getByRole("alert");
  await expect(alertA).toHaveText("Could not restart agents. Worker restart timed out");
  restartA = projectA.getByRole("button", { name: "Restart agents" });
  await expect(restartA).toBeEnabled();
  await expect(alertA).toHaveAttribute("id", "restart-agents-error-project-a");
  await expect(restartA).toHaveAttribute("aria-describedby", "restart-agents-error-project-a");
  await expect(projectB.getByRole("button", { name: "Restart agents" })).toBeEnabled();
  await expect(projectB.getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  const healthGetsBeforeRetry = healthGets;
  const projectGetsBeforeRetry = projectGets;
  await restartA.click();
  await aSecondStarted;
  await expect(alertA).toHaveCount(0);
  const retryPendingA = projectA.getByRole("button", { name: "Restarting agents" });
  await expect(retryPendingA).toBeDisabled();
  await retryPendingA.evaluate((button) => button.click());
  await page.keyboard.press("Enter");
  expect(postCounts.get("project-a")).toBe(2);
  releaseASecond();
  await expect(projectA.getByRole("button", { name: "Restart agents" })).toBeEnabled();
  await expect(projectA.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => healthGets).toBe(healthGetsBeforeRetry + 1);
  await expect.poll(() => projectGets).toBe(projectGetsBeforeRetry + 1);
  await expect(projectB.getByRole("button", { name: "Restart agents" })).toBeEnabled();
  await expect(projectB.getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("task and delegated action bodies use two-line previews", async ({ page }) => {
  await page.goto("/");
  const task = page.getByRole("button", { name: /Prepare and ship the launch/ });
  const action = page.getByRole("button", { name: /Build the launch page/ });
  for (const row of [task, action]) {
    const body = row.locator("span").filter({ hasText: /Prepare and ship|Build the launch/ }).last();
    await expect(body).toBeVisible();
    expect(await body.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      lineClamp: getComputedStyle(node).webkitLineClamp,
      overflow: getComputedStyle(node).overflow,
    }))).toMatchObject({ lineClamp: "2", overflow: "hidden" });
  }
});

test("long dynamic task and chat content renders completely", async ({ page }, testInfo) => {
  const fs = await import("node:fs");
  const { DatabaseSync } = await import("node:sqlite");
  const root = path.join(process.cwd(), ".e2e", "workspace");
  const suffix = testInfo.project.name;
  const taskId = `long-content-${suffix}`;
  const messageId = `long-chat-${suffix}`;
  const paragraphs = Array.from({ length: 80 }, (_, index) => `Dynamic paragraph ${index + 1} ${"content ".repeat(12)}`);
  const fullTask = `${paragraphs.join("\n\n")}\nFINAL_TASK_SENTINEL`;
  const db = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
  db.prepare(`INSERT OR REPLACE INTO tasks(
    id,parent_id,origin_id,kind,source,creator,assignee,topic,body,result,status,attempts,error,created_at,claimed_at,completed_at)
    VALUES(?,NULL,NULL,'root','manual','dashboard','lead','long-task',?,NULL,'claimed',1,NULL,?,NULL,NULL)`)
    .run(taskId, fullTask, new Date().toISOString());
  const fullMessage = `${paragraphs.join("\n\n")}\nFINAL_CHAT_SENTINEL`;
  db.prepare(`INSERT OR REPLACE INTO tasks(
    id,parent_id,origin_id,kind,source,creator,assignee,topic,body,result,status,attempts,error,created_at,claimed_at,completed_at)
    VALUES(?,NULL,NULL,'message','message','builder','dashboard','long-content',?,NULL,'completed',1,NULL,?,NULL,?)`)
    .run(messageId, fullMessage, new Date().toISOString(), new Date().toISOString());
  db.close();

  try {
    await page.goto("/");
    const task = page.getByRole("button", { name: /Dynamic paragraph 1/ });
    await expect(task).toBeVisible();
    const taskBody = task.locator("span").filter({ hasText: "Dynamic paragraph 1" }).last();
    expect(await taskBody.evaluate((node) => node.scrollHeight)).toBeGreaterThan(await taskBody.evaluate((node) => node.clientHeight));

    await page.getByRole("button", { name: "Open conversation with builder" }).click();
    const dialog = page.getByRole("dialog", { name: "Conversation with builder" });
    const message = dialog.locator(`[data-chat-id="task:${messageId}"]`);
    await expect(message.getByText(paragraphs[0], { exact: true })).toBeVisible();
    await expect(message).toContainText("FINAL_CHAT_SENTINEL");
    expect(await message.evaluate((node) => node.scrollHeight)).toBe(await message.evaluate((node) => node.clientHeight));
  } finally {
    const cleanup = new DatabaseSync(path.join(root, ".cairn-harness", "harness.db"));
    cleanup.prepare("DELETE FROM tasks WHERE id IN (?,?)").run(taskId, messageId);
    cleanup.close();
  }
});

test("chat Markdown tables stay contained", async ({ page }) => {
  const longValue = `command-${"a".repeat(140)}`;
  await page.route("**/api/projects/*/messages?agent=builder*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "long-table",
            sender: "builder",
            recipient: "dashboard",
            body: `| Key | Value |\n| --- | --- |\n| Command | ${longValue} |`,
            status: "completed",
            timestamp: "2026-07-15T12:00:00Z",
            direction: "incoming",
            kind: "assistant",
          },
          {
            id: "short-table",
            sender: "builder",
            recipient: "dashboard",
            body: "| Status | Owner |\n| --- | --- |\n| Ready | Builder |",
            status: "completed",
            timestamp: "2026-07-15T12:01:00Z",
            direction: "incoming",
            kind: "assistant",
          },
        ],
        hasMore: false,
      }),
    });
  });

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with builder" }).click();
  const dialog = page.getByRole("dialog", { name: /^Conversation with / });
  const longRegion = dialog.getByRole("region", { name: "Scrollable table: Key, Value" });
  const longTable = longRegion.getByRole("table");

  await expect(longRegion).toContainText(longValue);
  await expect(longRegion).toHaveAttribute("tabindex", "0");
  await expect(longTable.getByRole("columnheader")).toHaveCount(2);
  const narrow = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }));
  expect(narrow.pageWidth).toBeLessThanOrEqual(narrow.viewportWidth);
  expect(await dialog.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
  expect(await longRegion.evaluate((node) => node.scrollWidth)).toBeGreaterThan(await longRegion.evaluate((node) => node.clientWidth));
  await longRegion.evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
  expect(await longRegion.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1024, height: 844 });
  const shortTable = dialog.getByRole("table").nth(1);
  const shortWrapper = shortTable.locator("..");
  await expect(shortWrapper).not.toHaveAttribute("role");
  await expect(shortWrapper).not.toHaveAttribute("tabindex");
  expect(await shortWrapper.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(await shortWrapper.evaluate((node) => node.clientWidth + 1));
  await expect(shortTable).toContainText("Builder");
});

test("draft workbench stays mounted through empty, create, and final close states", async ({ page }) => {
  const projects = await page.request.get("/api/projects");
  const [project] = await projects.json() as Array<{ id: string; drafts: Array<{ id: string }> }>;
  for (const draft of project.drafts) {
    await page.request.delete(`/api/projects/${project.id}/draft?id=${encodeURIComponent(draft.id)}`);
  }
  await page.goto("/");
  const workbench = page.getByRole("region", { name: "Draft workbench" });
  const createDraft = workbench.getByRole("button", { name: "New draft" });
  await expect(workbench).toBeVisible();
  await expect(workbench).toHaveCount(1);
  await expect(createDraft).toBeVisible();
  await expect(createDraft).toHaveAttribute("aria-keyshortcuts", "Control+N Meta+N");
  await expect(workbench.getByRole("tablist", { name: "Task drafts" })).toHaveCount(0);
  await expect(workbench.getByRole("textbox", { name: "Draft document" })).toHaveCount(0);
  await expect(workbench.getByRole("separator", { name: "Resize draft workbench" })).toHaveCount(0);
  await expect(createDraft).not.toBeFocused();
  const emptyHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);
  expect(emptyHeight).toBeLessThanOrEqual(44);

  await createDraft.click();
  await expect(workbench.getByRole("tab", { selected: true })).toHaveCount(1);
  await expect(createDraft).toBeVisible();
  const editor = workbench.getByRole("textbox", { name: "Draft document" });
  await expect(editor).toBeFocused();
  const openHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);
  expect(openHeight).toBeGreaterThanOrEqual(220);
  await expect(workbench.getByRole("separator", { name: "Resize draft workbench" })).toBeVisible();

  await workbench.getByRole("button", { name: "Close draft: Untitled" }).click();
  await expect(workbench).toHaveCount(1);
  await expect(createDraft).toBeVisible();
  await expect(createDraft).toBeFocused();
  await expect(workbench.getByRole("tablist", { name: "Task drafts" })).toHaveCount(0);
  await expect(workbench.getByRole("textbox", { name: "Draft document" })).toHaveCount(0);
  expect(Math.abs(await workbench.evaluate((node) => node.getBoundingClientRect().height) - emptyHeight)).toBeLessThanOrEqual(1);
  await createDraft.click();
  expect(Math.abs(await workbench.evaluate((node) => node.getBoundingClientRect().height) - openHeight)).toBeLessThanOrEqual(1);
});

test("draft close and discard keep safe focus and preserve failures", async ({ page }) => {
  const projects = await page.request.get("/api/projects");
  const [project] = await projects.json() as Array<{ id: string; drafts: Array<{ id: string }> }>;
  for (const draft of project.drafts) {
    await page.request.delete(`/api/projects/${project.id}/draft?id=${encodeURIComponent(draft.id)}`);
  }
  await page.goto("/");
  const workbench = page.getByRole("region", { name: "Draft workbench" });
  await workbench.getByRole("button", { name: "New draft" }).click();
  const editor = workbench.getByRole("textbox", { name: "Draft document" });
  await editor.fill("Unsaved close");
  const close = workbench.getByRole("button", { name: "Close draft: Unsaved close" });
  await close.click();
  const closeDialog = page.getByRole("alertdialog", { name: "Close unsaved draft?" });
  await expect(closeDialog).toBeVisible();
  await expect(closeDialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(close).toBeFocused();
  await close.click();
  await closeDialog.getByRole("button", { name: "Close without saving" }).click();
  await expect(workbench.getByRole("tab")).toHaveCount(0);

  await workbench.getByRole("button", { name: "New draft" }).click();
  const discardSaved = page.waitForResponse((response) => response.url().includes("/draft") && response.request().method() === "PUT" && response.ok());
  await editor.fill("Saved discard");
  await discardSaved;
  await page.route(`**/api/projects/${project.id}/draft?id=*`, async (route) => {
    if (route.request().method() === "DELETE") await route.fulfill({ status: 500, json: { error: "Delete failed" } });
    else await route.continue();
  });
  await workbench.getByRole("button", { name: "Close draft: Saved discard" }).click();
  const closeError = page.getByRole("dialog", { name: "Draft not closed" });
  await expect(closeError).toBeVisible();
  await expect(editor).toContainText("Saved discard");
  await page.unroute(`**/api/projects/${project.id}/draft?id=*`);
  await closeError.getByRole("button", { name: "Try again" }).click();
  await expect(workbench.getByRole("tab")).toHaveCount(0);
});

test("project lead adds a task", async ({ page }) => {
  await page.goto("/");
  const fixtureDirectory = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const dbPath = path.join(process.cwd(), fixtureDirectory, "workspace", ".cairn-harness", "harness.db");
  const drafts = path.join(process.cwd(), fixtureDirectory, "workspace", ".cairn-harness", "drafts");
  const fs = await import("node:fs");
  const before = taskCount(dbPath);
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  await expect(editor).toHaveText("");
  await editor.fill("Prepare the launch checklist with mobile verification.");
  await expect.poll(() => fs.readdirSync(drafts).some((name) => fs.readFileSync(path.join(drafts, name), "utf8").includes("Prepare the launch checklist"))).toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: /Prepare the launch checklist/ }).click();
  await expect(page.getByRole("textbox", { name: "Draft document" })).toContainText("Prepare the launch checklist");
  await page.getByRole("button", { name: "Start work" }).click();
  await expect.poll(() => taskCount(dbPath)).toBe(before + 1);
  await expect.poll(() => fs.readdirSync(drafts).some((name) => fs.readFileSync(path.join(drafts, name), "utf8").includes("Prepare the launch checklist"))).toBe(false);
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  const activeTask = page.getByRole("button", { name: /Prepare the launch checklist.*(Queued|Running)/ }).last();
  await expect(activeTask).toBeVisible();
});

test("task document uses native pointer and keyboard focus modality", async ({ page }) => {
  await page.goto("/");
  const newTask = page.getByRole("button", { name: "New task" });
  await newTask.click();
  const taskEditor = page.getByRole("region", { name: "Draft editor" });
  const editor = taskEditor.getByRole("textbox", { name: "Draft document" });
  const documentShell = editor.locator("..");
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  expect(await documentShell.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  expect(await editor.evaluate((node) => getComputedStyle(node).borderInlineStartColor)).toBe("rgba(0, 0, 0, 0)");
  const checklist = taskEditor.getByRole("button", { name: "Checklist" });
  await checklist.focus();
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node) => getComputedStyle(node).borderInlineStartColor)).toBe("rgb(120, 169, 230)");
  await editor.click();
  expect(await editor.evaluate((node) => getComputedStyle(node).borderInlineStartColor)).toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "Close draft: Untitled" }).click();
  const createDraft = page.getByRole("button", { name: "New draft" });
  await expect.poll(() => page.evaluate(() =>
    document.activeElement?.getAttribute("aria-selected") === "true"
    || document.activeElement?.textContent?.includes("New draft"),
  )).toBe(true);
  await createDraft.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  expect(await editor.evaluate((node) => getComputedStyle(node).boxShadow)).toBe("none");
  expect(await documentShell.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  expect(await editor.evaluate((node) => getComputedStyle(node).borderInlineStartColor)).toBe("rgb(120, 169, 230)");
  await page.emulateMedia({ forcedColors: "active" });
  expect(await editor.evaluate((node) => getComputedStyle(node).borderInlineStartWidth)).toBe("3px");
});

test("Markdown toolbar reflects active formatting", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  const textStyle = page.getByRole("button", { name: "Text style", exact: true });
  const bold = page.getByRole("button", { name: "Bold", exact: true });
  const italic = page.getByRole("button", { name: "Italic", exact: true });
  const code = page.getByRole("button", { name: "Inline code", exact: true });
  const bullet = page.getByRole("button", { name: "Bulleted list", exact: true });
  const checklist = page.getByRole("button", { name: "Checklist", exact: true });

  for (const button of [bold, italic, code, bullet, checklist]) {
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }

  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
  await expect(textStyle).toContainText("Heading 2");
  await editor.pressSequentially("Heading");
  await editor.press("Shift+Enter");

  await bold.click();
  await editor.pressSequentially("Bold");
  await bold.click();
  await editor.pressSequentially(" plain");
  await expect(bold).toHaveAttribute("aria-pressed", "false");

  for (const button of [italic, code]) {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }
  await bullet.click();
  await expect(bullet).toHaveAttribute("aria-pressed", "true");
  await checklist.click();
  await expect(bullet).toHaveAttribute("aria-pressed", "false");
  await expect(checklist).toHaveAttribute("aria-pressed", "true");

  const content = await editor.textContent();
  async function select(startText: string, startOffset: number, endText = startText, endOffset = startOffset) {
    await editor.evaluate((root, range) => {
      const iterator = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
      const textNodes: Node[] = [];
      let node: Node | null;
      while ((node = iterator.nextNode())) textNodes.push(node);
      const start = textNodes.find((node) => node.textContent?.includes(range.startText));
      const end = textNodes.find((node) => node.textContent?.includes(range.endText));
      if (!start || !end) throw new Error("Could not find editor selection text");
      (root as HTMLElement).focus();
      const selection = getSelection();
      const domRange = document.createRange();
      domRange.setStart(start, range.startOffset);
      domRange.setEnd(end, range.endOffset);
      selection?.removeAllRanges();
      selection?.addRange(domRange);
      document.dispatchEvent(new Event("selectionchange"));
    }, { startText, startOffset, endText, endOffset });
  }

  await select("Bold", 2);
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  expect(await bold.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await editor.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(checklist).toBeFocused();
  expect(await checklist.evaluate((button) => getComputedStyle(button).boxShadow)).not.toBe("none");
  await page.keyboard.press("ArrowLeft");
  await expect(bullet).toBeFocused();

  await select(" plain", 3);
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await select("Bold", 1, " plain", 3);
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  expect(await editor.textContent()).toBe(content);

  await editor.fill("");
  const activeDraftId = await page.getByRole("tab", { selected: true }).getAttribute("data-draft-tab-id");
  await page.locator(`button[data-draft-close-id="${activeDraftId}"]`).click();
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  const prompt = page.getByRole("textbox", { name: "Instructions" });
  await prompt.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("textbox", { name: "Description" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(prompt).toBeFocused();
  expect(await prompt.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
});

test("task editor preserves newest content during overlapping saves", async ({ page }) => {
  let releaseFirstSave!: () => void;
  const firstSaveReleased = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
  let firstSaveStarted!: () => void;
  const firstSave = new Promise<void>((resolve) => { firstSaveStarted = resolve; });
  let followUpSaveStarted!: () => void;
  const followUpSave = new Promise<void>((resolve) => { followUpSaveStarted = resolve; });
  let sendStarted!: () => void;
  const sent = new Promise<void>((resolve) => { sendStarted = resolve; });
  let releaseSend!: () => void;
  const sendReleased = new Promise<void>((resolve) => { releaseSend = resolve; });
  const savedBodies: string[] = [];
  const sentBodies: string[] = [];
  let activeSaves = 0;
  let maxActiveSaves = 0;
  let submitted = false;
  let projectRefreshes = 0;

  await page.route("**/api/projects/*/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    const body = (request.postDataJSON() as { body: string }).body;
    savedBodies.push(body);
    activeSaves += 1;
    maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
    if (savedBodies.length === 1) {
      firstSaveStarted();
      await firstSaveReleased;
    }
    if (savedBodies.length === 2) followUpSaveStarted();
    await route.continue();
    activeSaves -= 1;
  });
  await page.route("**/api/projects/*/draft/submit", async (route, request) => {
    sentBodies.push((request.postDataJSON() as { body: string }).body);
    submitted = true;
    sendStarted();
    await sendReleased;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"id":"overlap-test"}' });
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() === "GET" && submitted) projectRefreshes += 1;
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  await editor.fill("Initial blocked draft.");
  await firstSave;
  await editor.fill("Intermediate overlapping task content.");
  await editor.fill("Newest overlapping task content.");
  const sendButton = page.getByRole("button", { name: "Create task" });
  await expect(sendButton).toBeEnabled();
  await editor.press("Control+Enter");
  expect(sentBodies).toEqual([]);
  await expect(page.getByRole("button", { name: "Creating task…" })).toBeDisabled();
  await expect(page.getByText("Saving draft…", { exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(savedBodies).toEqual(["Initial blocked draft."]);
  expect(maxActiveSaves).toBe(1);

  releaseFirstSave();
  await followUpSave;
  await sent;
  await expect(page.getByRole("button", { name: "Creating task…" })).toBeDisabled();
  await page.getByRole("button", { name: "Creating task…" }).evaluate((button: HTMLButtonElement) => button.click());
  expect(sentBodies).toEqual(["Newest overlapping task content."]);
  releaseSend();
  expect(savedBodies).toEqual([
    "Initial blocked draft.",
    "Newest overlapping task content.",
  ]);
  expect(savedBodies).not.toContain("Intermediate overlapping task content.");
  expect(sentBodies).toEqual(["Newest overlapping task content."]);
  await expect(editor).toHaveText("");
  await expect(editor).toBeFocused();
  await expect(page.getByText("Task created", { exact: true })).toBeVisible();
  expect(projectRefreshes).toBe(0);
  expect(maxActiveSaves).toBe(1);
});

test("immediate send saves the latest draft before one submission", async ({ page }) => {
  const requests: string[] = [];
  let releaseSave!: () => void;
  const saveReleased = new Promise<void>((resolve) => { releaseSave = resolve; });
  let saveStarted!: () => void;
  const saving = new Promise<void>((resolve) => { saveStarted = resolve; });

  await page.route("**/api/projects/*/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    requests.push(`save:${(request.postDataJSON() as { body: string }).body}`);
    saveStarted();
    await saveReleased;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/projects/*/draft/submit", async (route, request) => {
    requests.push(`submit:${(request.postDataJSON() as { body: string }).body}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"id":"immediate-test"}' });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByRole("textbox", { name: "Draft document" }).fill("Immediate durable task.");
  const editorHandle = await page.getByRole("textbox", { name: "Draft document" }).elementHandle();
  const sendButton = page.getByRole("button", { name: "Start work" });
  await sendButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await saving;
  await expect(page.getByRole("button", { name: "Starting work…" })).toBeDisabled();
  expect(requests).toEqual(["save:Immediate durable task."]);
  releaseSave();
  await expect.poll(() => requests).toEqual([
    "save:Immediate durable task.",
    "submit:Immediate durable task.",
  ]);
  await expect(page.getByRole("textbox", { name: "Draft document" })).toHaveText("Existing draft task.");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Existing draft task");
  await expect(page.getByRole("tab", { selected: true })).toBeFocused();
  expect(await editorHandle!.evaluate((node) => node.isConnected)).toBe(false);
});

test("draft tabs keep independent content and sending closes only one tab", async ({ page }) => {
  const saves: Array<{ id: string; body: string }> = [];
  const submissions: Array<{ id: string; body: string }> = [];
  await page.route("**/api/projects/*/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    saves.push(request.postDataJSON() as { id: string; body: string });
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/projects/*/draft/submit", async (route, request) => {
    submissions.push(request.postDataJSON() as { id: string; body: string });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "submitted" }) });
  });

  await page.goto("/");
  const workbench = page.getByRole("region", { name: "Draft workbench" });
  const persistedDraft = page.getByRole("button", { name: /Existing draft task.*draft/i });
  await persistedDraft.click();
  await persistedDraft.click();
  await expect(workbench.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Existing draft task");
  await page.getByRole("button", { name: /Close draft: Existing draft task/ }).click();
  await expect(page.getByRole("tablist", { name: "Open drafts" })).toHaveCount(0);
  await expect(persistedDraft).toBeVisible();

  for (const body of ["First isolated draft.", "Second isolated draft.", "Third isolated draft."]) {
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByRole("textbox", { name: "Task document" }).fill(body);
    await expect.poll(() => saves.filter((save) => save.body === body).length).toBe(1);
  }

  const tabs = workbench.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  const tablist = page.getByRole("tablist", { name: "Open drafts" });
  for (let index = 0; index < 3; index += 1) {
    const tab = tabs.nth(index);
    const tabId = await tab.getAttribute("id");
    const panelId = await tab.getAttribute("aria-controls");
    expect(tabId).toBeTruthy();
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute("aria-labelledby", tabId!);
  }
  expect(await tablist.evaluate((node) =>
    [...node.children].every((child) => child.getAttribute("role") === "tab"),
  )).toBe(true);
  await expect(tablist.locator("[role='tab'][tabindex='0']")).toHaveCount(1);
  await expect(tablist.locator("[role='tab'][tabindex='-1']")).toHaveCount(2);
  await expect(workbench.getByRole("button", { name: /^Close draft:/ })).toHaveCount(3);
  const accessibility = await new AxeBuilder({ page })
    .include("[data-draft-workbench]")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await tabs.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close draft: First isolated draft." })).not.toBeFocused();
  for (const [index, body] of ["First isolated draft.", "Second isolated draft.", "Third isolated draft."].entries()) {
    await tabs.nth(index).click();
    await expect(page.getByRole("textbox", { name: "Task document" })).toContainText(body);
  }
  const dragAffordances = await tabs.evaluateAll((items) => items.map((item) => ({
    id: (item as HTMLElement).dataset.draftTabId,
    cursor: getComputedStyle(item).cursor,
  })));
  expect(dragAffordances.every((tab) => Boolean(tab.id) && tab.cursor === "grab")).toBe(true);
  expect(new Set(dragAffordances.map((tab) => tab.id)).size).toBe(3);
  expect(new Set(saves.map((save) => save.id)).size).toBe(3);

  await tabs.nth(2).click();
  await page.getByRole("button", { name: "Close draft: First isolated draft." }).click();
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Third isolated draft.");
  await expect(page.getByRole("tab", { selected: true })).toBeFocused();
  await tabs.nth(0).click();
  await page.getByRole("button", { name: "Create task" }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0].body).toBe("Second isolated draft.");
  await expect(tabs).toHaveCount(1);
  await expect(page.getByRole("tab", { selected: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Task document" })).toContainText("Third isolated draft.");
  await page.getByRole("button", { name: "New draft" }).click();
  await page.getByRole("textbox", { name: "Task document" }).fill("Last active draft.");
  await expect(tabs).toHaveCount(2);
  await page.getByRole("button", { name: "Close draft: Last active draft." }).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Third isolated draft.");
  await expect(page.getByRole("tab", { selected: true })).toBeFocused();
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Task document" })).toHaveText("");
  await expect(page.getByRole("textbox", { name: "Task document" })).toBeFocused();
  await expect(page.getByText("Task created", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close draft: Untitled" }).click();
  await expect(tabs).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Draft workbench" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create draft" })).toBeFocused();
});

test("draft tablist owns only tabs across workbench heights", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (!request.url().includes("/api/events") && !request.url().includes("/__nextjs_font/")) {
      errors.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  const projects = await page.request.get("/api/projects");
  const [project] = await projects.json() as Array<{ id: string; drafts: Array<{ id: string }> }>;
  for (const draft of project.drafts) {
    await page.request.delete(`/api/projects/${project.id}/draft?id=${encodeURIComponent(draft.id)}`);
  }
  await page.goto("/");
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "short", width: 960, height: 426 },
  ]) {
    await page.setViewportSize(viewport);
    const workbench = page.getByRole("region", { name: "Draft workbench" });
    const newDraft = workbench.getByRole("button", { name: "New draft" });
    for (const body of ["First isolated draft.", "Second isolated draft.", "Third isolated draft."]) {
      await newDraft.click();
      const draftSaved = page.waitForResponse((response) => response.url().includes("/draft") && response.request().method() === "PUT" && response.ok());
      await workbench.getByRole("textbox", { name: "Draft document" }).fill(body);
      await draftSaved;
    }
    const tablist = workbench.getByRole("tablist", { name: "Task drafts" });
    const tabs = workbench.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    expect(await tablist.evaluate((node) =>
      [...node.children].every((child) => child.getAttribute("role") === "tab"),
    )).toBe(true);
    expect(await tablist.locator("[role]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("role")),
    )).toEqual(["tab", "tab", "tab"]);
    expect(await newDraft.evaluate((button, list) => !list.contains(button), await tablist.elementHandle())).toBe(true);
    expect(await newDraft.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(viewport.width <= 720 ? 44 : 24);
    await expect(tablist.locator("[role='tab'][tabindex='0']")).toHaveCount(1);
    await expect(tablist.locator("[role='tab'][tabindex='-1']")).toHaveCount(2);
    const closeButtons = workbench.getByRole("button", { name: /^Close draft:/ });
    await expect(closeButtons).toHaveCount(3);
    for (const close of await closeButtons.all()) await expect(close).toHaveAttribute("tabindex", "-1");

    await tabs.last().focus();
    await page.keyboard.press("End");
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeButtons.first()).not.toBeFocused();
    await expect(newDraft).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(workbench.getByRole("button", { name: "Body" })).toBeFocused();

    await tabs.first().focus();
    await page.keyboard.press("Delete");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.first()).toBeFocused();
    await tabs.first().hover();
    await expect(closeButtons.first()).toHaveCSS("opacity", "1");
    await closeButtons.first().click();
    await expect(tabs).toHaveCount(1);

    await newDraft.click();
    const editor = workbench.getByRole("textbox", { name: "Draft document" });
    await editor.fill("Unsafe to discard silently");
    await tabs.last().focus();
    await page.keyboard.press("Delete");
    const closeDialog = page.getByRole("alertdialog", { name: "Close unsaved draft?" });
    await expect(closeDialog).toBeVisible();
    await expect(closeDialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tabs.last()).toBeFocused();
    await closeButtons.last().click();
    if (await closeDialog.isVisible()) {
      await closeDialog.getByRole("button", { name: "Close without saving" }).click();
    }
    await expect(tabs).toHaveCount(1);

    const geometry = await workbench.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, viewportHeight: innerHeight, scrollY };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.scrollY).toBe(0);
    const violations = (await new AxeBuilder({ page }).include("[data-draft-workbench]").analyze()).violations;
    expect(violations.filter((violation) => ["aria-required-children", "aria-required-parent"].includes(violation.id))).toEqual([]);
    expect(violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`tablist-${viewport.name}.png`), fullPage: true });
    while (await tabs.count()) {
      await workbench.getByRole("button", { name: /^Close draft:/ }).first().click();
    }
    await expect(workbench.getByText("No drafts", { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("sole draft submission keeps the editor stable across workbench layouts", async ({ page }) => {
  await page.route("**/api/projects/*/draft/submit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"id":"breakpoint-task"}' });
  });
  for (const width of [1050, 720, 390, 1051]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const workbench = page.getByRole("region", { name: "Draft workbench" });
    const initialHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);
    const createDraft = page.getByRole("button", { name: "Create draft" });
    if (width <= 720) {
      expect(await createDraft.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await createDraft.click();
    const editor = page.getByRole("textbox", { name: "Draft document" });
    await editor.fill(`Breakpoint task ${width}`);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(workbench).toBeVisible();
    await expect.poll(() => workbench.evaluate((node) => node.getBoundingClientRect().height)).toBe(initialHeight);
    await expect(editor).toHaveText("");
    await expect(editor).toBeFocused();
    await expect(workbench.getByRole("status")).toHaveText("Task created");
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      scrollY,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);
    expect(viewport.scrollY).toBe(0);
  }
});

test("draft workbench uses autosave controls and scoped keyboard commands", async ({ page }) => {
  const submissions: string[] = [];
  let releaseSubmission!: () => void;
  const submissionReleased = new Promise<void>((resolve) => { releaseSubmission = resolve; });
  await page.route("**/api/projects/*/draft/submit", async (route, request) => {
    submissions.push((request.postDataJSON() as { body: string }).body);
    if (submissions.length === 1) await submissionReleased;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"id":"keyboard-task"}' });
  });
  await page.goto("/");
  const newTask = page.getByRole("button", { name: "New task" });
  await newTask.click();
  const workbench = page.getByRole("region", { name: "Draft workbench" });
  const editor = page.getByRole("textbox", { name: "Draft document" });
  const create = page.getByRole("button", { name: "Create task" });
  const saveStatus = workbench.getByRole("status");
  await expect(page.getByRole("heading", { name: "Draft workbench" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save draft|Close editor/ })).toHaveCount(0);
  await expect(saveStatus).toBeEmpty();
  await expect(saveStatus).toHaveAttribute("aria-atomic", "true");
  await expect(create).toBeDisabled();
  await expect(editor).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
  await expect(create).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
  await expect(workbench.getByText("Ctrl/⌘+Enter to create · Enter for new line", { exact: true })).toBeVisible();
  await editor.press("Control+Enter");
  expect(submissions).toHaveLength(0);
  await editor.fill("# Keyboard task");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Keyboard task");
  await expect(page.getByLabel("Unsaved changes")).toHaveCount(0);
  await expect(saveStatus).toHaveText("Saving draft…");
  await expect(saveStatus).toHaveText("Draft saved");
  await expect(saveStatus).toBeEmpty({ timeout: 3_000 });
  await expect(create).toBeEnabled();

  await editor.press("Enter");
  await editor.pressSequentially("Second line");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("Shift line");
  await editor.press("Control+Shift+Enter");
  await editor.pressSequentially("Modified line");
  await editor.press("Alt+Enter");
  await editor.pressSequentially("Alt line");
  await editor.dispatchEvent("compositionstart");
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true, isComposing: true });
  await editor.dispatchEvent("compositionend");
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true, repeat: true });
  expect(submissions).toHaveLength(0);
  expect((await editor.innerText()).split(/\r?\n/).length).toBeGreaterThan(1);

  const beforeShortcut = await workbench.getByRole("tab").count();
  await editor.press("Control+n");
  await expect(workbench.getByRole("tab")).toHaveCount(beforeShortcut + 1);
  await expect(page.getByRole("textbox", { name: "Task document" })).toBeFocused();
  await page.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("Delete");
  await expect(workbench.getByRole("tab")).toHaveCount(beforeShortcut);
  await expect(page.getByRole("tab", { selected: true })).toBeFocused();
  const outsidePrevented = await newTask.evaluate((button) => {
    const event = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(outsidePrevented).toBe(false);
  await expect(workbench.getByRole("tab")).toHaveCount(beforeShortcut);

  await workbench.getByRole("tab").first().click();
  await editor.press("Control+Enter");
  await expect.poll(() => submissions).toHaveLength(1);
  await editor.press("Control+Enter");
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toContain("Keyboard task");
  expect(submissions[0]).toContain("Second line");
  expect(submissions[0]).toContain("Shift line");
  expect(submissions[0]).toContain("Modified line");
  expect(submissions[0]).toContain("Alt line");
  await expect(page.getByRole("button", { name: "Creating task…" })).toBeDisabled();
  releaseSubmission();
  await expect(editor).toHaveText("");
  await expect(editor).toBeFocused();
  await expect(saveStatus).toHaveText("Task created");
  await editor.fill("Meta Enter task");
  await editor.press("Meta+Enter");
  await expect.poll(() => submissions).toHaveLength(2);
  expect(submissions[1]).toContain("Meta Enter task");
});

test("inactive draft close flushes and save failure keeps the draft recoverable", async ({ page }) => {
  let failingId = "";
  await page.route("**/api/projects/*/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    const data = request.postDataJSON() as { id: string; body: string };
    if (!failingId) failingId = data.id;
    if (data.id === failingId) {
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Draft storage unavailable"}' });
    }
    return route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  await editor.fill("Keep this inactive draft.");
  await expect(page.getByRole("status").filter({ hasText: "Draft not saved." })).toBeVisible();
  await page.getByRole("button", { name: "New draft" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab").first()).toHaveAccessibleName(/Save error/);

  await page.getByRole("button", { name: "Close draft: Keep this inactive draft." }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Keep this inactive draft.");
  await expect(editor).toContainText("Keep this inactive draft.");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).not.toHaveAccessibleName(/Save error/);
});

test("draft workbench is separate, bottom anchored, and resizable", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (!request.url().includes("/api/events") && !request.url().includes("/__nextjs_font/")) {
      errors.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel("Active work").getByRole("button", { name: "New task" }).click();
  const workbench = page.locator("[data-draft-workbench]");
  const spacer = page.locator("[data-draft-workbench-spacer]");
  const resize = page.getByRole("separator", { name: "Resize draft workbench" });
  const startWork = workbench.getByRole("button", { name: "Start work" });
  await expect(workbench).toBeVisible();
  expect(await workbench.evaluate((node) => Boolean(node.closest("main")))).toBe(false);
  const desktop = await workbench.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const panel = node.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!.getBoundingClientRect();
    const main = document.querySelector("main")!.getBoundingClientRect();
    return {
      bottomGap: Math.abs(innerHeight - rect.bottom),
      panelInset: panel.top - rect.top,
      mainBottom: main.bottom,
      workbenchTop: rect.top,
    };
  });
  expect(desktop.bottomGap).toBeLessThanOrEqual(2);
  expect(desktop.panelInset).toBeLessThanOrEqual(50);
  expect(desktop.mainBottom).toBeLessThanOrEqual(desktop.workbenchTop + 1);
  await expect(spacer).toBeHidden();

  const initialHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);
  await resize.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => workbench.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(initialHeight);
  const keyboardHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);
  const handle = await resize.boundingBox();
  if (!handle) throw new Error("Resize handle is not visible");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 72);
  await page.mouse.up();
  await expect.poll(() => workbench.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(keyboardHeight + 40);

  const matrix: Array<Record<string, number | string | boolean>> = [];
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 960, height: 426 },
    { width: 800, height: 600 },
    { width: 800, height: 320 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 320, height: 180 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(workbench).toHaveCSS("position", "fixed");
    const maximumHeight = Math.round(viewport.height * (viewport.width <= 720 ? .7 : .75));
    await expect(resize).toHaveAttribute("aria-valuemax", String(maximumHeight));
    await expect(startWork).toBeVisible();
    const geometry = await workbench.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const tablist = node.querySelector<HTMLElement>("[role='tablist']")!;
      const strip = tablist.parentElement!.parentElement!.getBoundingClientRect();
      const tabs = tablist.getBoundingClientRect();
      const activePanel = node.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
      const status = activePanel.querySelector("footer")!.getBoundingClientRect();
      const action = activePanel.querySelector<HTMLElement>("button[aria-keyshortcuts='Control+Enter Meta+Enter']")!.getBoundingClientRect();
      const selected = node.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")!;
      const close = node.parentElement!.querySelector<HTMLElement>(`[data-draft-close-id='${selected.dataset.draftTabId}']`)!;
      const selectedRect = selected.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      return {
        bottomGap: Math.abs(innerHeight - rect.bottom),
        left: rect.left,
        right: innerWidth - rect.right,
        height: rect.height,
        stripVisible: strip.top >= rect.top && strip.bottom <= rect.bottom,
        tabsVisible: tabs.top >= rect.top && tabs.bottom <= rect.bottom,
        statusVisible: status.top >= rect.top && status.bottom <= rect.bottom,
        actionVisible: action.top >= rect.top && action.bottom <= rect.bottom && action.bottom <= innerHeight,
        closeRightDelta: Math.abs(closeRect.right - selectedRect.right),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    const spacerGeometry = await spacer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const main = document.querySelector("main")!.getBoundingClientRect();
      return { height: rect.height, top: rect.top, mainBottom: main.bottom };
    });
    const workbenchHeight = await workbench.evaluate((node) => node.getBoundingClientRect().height);
    expect(geometry.bottomGap, `${viewport.width}x${viewport.height} bottom gap`).toBeLessThanOrEqual(2);
    expect(geometry.stripVisible).toBe(true);
    expect(geometry.tabsVisible).toBe(true);
    expect(geometry.statusVisible).toBe(true);
    expect(geometry.actionVisible).toBe(true);
    expect(geometry.closeRightDelta, `${viewport.width}x${viewport.height} close alignment`).toBeLessThanOrEqual(1);
    expect(geometry.overflow).toBeLessThanOrEqual(0);
    expect(Math.round(spacerGeometry.height)).toBe(Math.round(workbenchHeight));
    expect(spacerGeometry.mainBottom).toBeLessThanOrEqual(spacerGeometry.top + 1);
    if (viewport.width <= 720) {
      expect(Math.abs(Number(geometry.left))).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(geometry.right))).toBeLessThanOrEqual(1);
      expect(workbenchHeight).toBeLessThanOrEqual(viewport.height * .7 + 1);
    } else {
      expect(Number(geometry.left)).toBeGreaterThanOrEqual(199);
      expect(workbenchHeight).toBeLessThanOrEqual(viewport.height * .75 + 1);
    }
    matrix.push({ viewport: `${viewport.width}x${viewport.height}`, ...geometry, spacerHeight: spacerGeometry.height });
  }
  expect((await new AxeBuilder({ page }).include("[data-draft-workbench]").analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach("bottom-anchor-geometry.json", {
    body: Buffer.from(JSON.stringify({ desktop, matrix }, null, 2)),
    contentType: "application/json",
  });
});

test("task drafting keeps the primary action inside the workbench at reduced heights", async ({ page }) => {
  for (const { width, height, label = `${width}x${height}` } of [
    { width: 1440, height: 568 },
    { width: 1440, height: 320 },
    { width: 960, height: 426, label: "1280x568 equivalent at 133% zoom" },
    { width: 800, height: 320 },
    { width: 320, height: 180 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const newTask = page.getByRole("button", { name: "New task" });
    await newTask.scrollIntoViewIfNeeded();
    await newTask.click();
    const editor = page.getByRole("textbox", { name: "Draft document" });
    await editor.fill(Array.from({ length: 24 }, (_, index) => `Overflow line ${index + 1}`).join("\n"));
    const create = page.getByRole("button", { name: "Start work" });
    await expect(create).toBeVisible();
    await expect(create).toBeEnabled();
    const geometry = await create.evaluate((button, editorNode) => {
      const action = button.getBoundingClientRect();
      const workbench = button.closest<HTMLElement>("[data-draft-workbench]")!.getBoundingClientRect();
      const editorScrollRegion = (editorNode as HTMLElement).parentElement!;
      return {
        actionLeft: action.left,
        actionRight: action.right,
        actionTop: action.top,
        actionBottom: action.bottom,
        workbenchLeft: workbench.left,
        workbenchRight: workbench.right,
        workbenchTop: workbench.top,
        workbenchBottom: workbench.bottom,
        editorClientHeight: editorScrollRegion.clientHeight,
        editorScrollHeight: editorScrollRegion.scrollHeight,
        editorScrollTop: editorScrollRegion.scrollTop,
        editorOverflowY: getComputedStyle(editorScrollRegion).overflowY,
        viewportHeight: innerHeight,
      };
    }, await editor.elementHandle());
    expect(geometry.actionLeft, `${label} action left`).toBeGreaterThanOrEqual(geometry.workbenchLeft);
    expect(geometry.actionRight, `${label} action right`).toBeLessThanOrEqual(geometry.workbenchRight);
    expect(geometry.actionTop, `${label} action top`).toBeGreaterThanOrEqual(geometry.workbenchTop);
    expect(geometry.actionBottom, `${label} action bottom`).toBeLessThanOrEqual(geometry.workbenchBottom);
    expect(geometry.actionTop, `${label} viewport action top`).toBeGreaterThanOrEqual(0);
    expect(geometry.actionBottom, `${label} viewport action bottom`).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.editorOverflowY, `${label} editor overflow`).toBe("auto");
    expect(geometry.editorScrollHeight, `${label} editor content overflow`).toBeGreaterThan(geometry.editorClientHeight);
    expect(geometry.editorScrollTop, `${label} editor scrolling`).toBeGreaterThan(0);
    await editor.press("Tab");
    await expect(create, `${label} keyboard focus order`).toBeFocused();
  }
});

test("draft editor state stays scoped when projects share a draft id", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const draft = (title: string, content: string) => ({
    id: "shared-draft",
    title,
    meta: "",
    status: "draft",
    content,
  });
  const projects = [
    { ...baseProject, id: "draft-scope-a", name: "Draft scope A", drafts: [draft("Project A shared draft", "Project A content.")] },
    { ...baseProject, id: "draft-scope-b", name: "Draft scope B", drafts: [draft("Project B shared draft", "Project B content.")] },
  ];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route("**/api/projects/*/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Draft document" });
  await expect(editor).toContainText("Project A content.");
  await editor.fill("Project A edited content.");
  await page.locator('[data-project-selection="draft-scope-b"]').click();
  await expect(editor).toContainText("Project B content.");
  await expect(editor).not.toContainText("Project A edited content.");

  await page.locator('[data-project-selection="draft-scope-a"]').click();
  await expect(editor).toContainText("Project A edited content.");
});

test("persisted open draft tabs and active identity restore after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Close draft: Existing draft task." }).click();
  for (const body of ["Restored first draft.", "Restored second draft.", "Restored active draft."]) {
    await page.getByRole("button", { name: "New task" }).click();
    const restoredSaved = page.waitForResponse((response) => response.url().includes("/draft") && response.request().method() === "PUT" && response.ok());
    await page.getByRole("textbox", { name: "Draft document" }).fill(body);
    await restoredSaved;
  }
  await expect(page.getByRole("tab", { selected: true })).toContainText("Restored active draft.");
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("harness-draft-workspaces") || "{}") as Record<string, string>;
    const identity = Object.values(stored).map((value) => JSON.parse(value) as { openIds?: string[] });
    return identity.some((value) => value.openIds?.length === 3);
  })).toBe(true);
  const tabsBeforeReorder = await page.getByRole("region", { name: "Draft workbench" }).getByRole("tab").evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).dataset.draftTabId || ""),
  );
  const tabs = page.getByRole("region", { name: "Draft workbench" }).getByRole("tab");
  const firstTab = await tabs.nth(0).boundingBox();
  const thirdTab = await tabs.nth(2).boundingBox();
  if (!firstTab || !thirdTab) throw new Error("Draft tabs are not visible");
  await page.mouse.move(firstTab.x + firstTab.width / 2, firstTab.y + firstTab.height / 2);
  await page.mouse.down();
  await page.mouse.move(thirdTab.x + thirdTab.width / 2, thirdTab.y + thirdTab.height / 2);
  await page.mouse.up();
  const mouseOrder = [tabsBeforeReorder[1], tabsBeforeReorder[2], tabsBeforeReorder[0]];
  await expect.poll(() => tabs.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.draftTabId || ""))).toEqual(mouseOrder);
  await tabs.nth(0).click();
  const selectedContent = await page.getByRole("textbox", { name: "Draft document" }).textContent();
  await expect(tabs.nth(0)).toHaveCSS("touch-action", "none");
  await expect(tabs.nth(1)).toHaveCSS("touch-action", "pan-x");
  const touchSource = await tabs.nth(0).boundingBox();
  const touchTarget = await tabs.nth(1).boundingBox();
  if (!touchSource || !touchTarget) throw new Error("Reordered draft tabs are not visible");
  await tabs.nth(0).dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    clientX: touchSource.x + touchSource.width / 2,
    clientY: touchSource.y + touchSource.height / 2,
  });
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch", clientX: x, clientY: y, bubbles: true }));
  }, { x: touchTarget.x + touchTarget.width / 2, y: touchTarget.y + touchTarget.height / 2 });
  const persistedOrder = [mouseOrder[1], mouseOrder[0], mouseOrder[2]];
  await expect.poll(() => tabs.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.draftTabId || ""))).toEqual(persistedOrder);
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("harness-draft-workspaces") || "{}") as Record<string, string>;
    return Object.values(stored).map((value) => (JSON.parse(value) as { openIds?: string[] }).openIds)
      .find((openIds) => openIds?.length === 3);
  })).toEqual(persistedOrder);
  await page.evaluate(() => {
    const key = "harness-draft-workspaces";
    const stored = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, string>;
    const projectId = Object.keys(stored).find((id) => {
      const identity = JSON.parse(stored[id]) as { openIds?: string[] };
      return identity.openIds?.length === 3;
    });
    if (!projectId) throw new Error("Could not find persisted draft workspace");
    const identity = JSON.parse(stored[projectId]) as { openIds: string[]; activeId?: string };
    identity.openIds.push("stale-draft-id");
    stored[projectId] = JSON.stringify(identity);
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  await expect(tabs).toHaveCount(4);
  await expect(page.getByRole("tab", { name: "Existing draft task." })).toBeVisible();
  await expect.poll(() => tabs.evaluateAll(
    (items, expectedIds) => items
      .map((item) => (item as HTMLElement).dataset.draftTabId || "")
      .filter((id) => expectedIds.includes(id)),
    persistedOrder,
  )).toEqual(persistedOrder);
  await expect(page.getByRole("tab", { selected: true })).toHaveAttribute("data-draft-tab-id", mouseOrder[0]);
  await expect(page.getByRole("textbox", { name: "Draft document" })).toHaveText(selectedContent || "");
  await expect.poll(() => page.evaluate(() => !localStorage.getItem("harness-draft-workspaces")?.includes("stale-draft-id"))).toBe(true);
});

test("project switch waits for the newest pending editor save", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const projects = [
    { ...baseProject, id: "save-switch-a", name: "Save switch A" },
    { ...baseProject, id: "save-switch-b", name: "Save switch B" },
  ];
  let saveStarted!: () => void;
  let releaseSave!: () => void;
  const started = new Promise<void>((resolve) => { saveStarted = resolve; });
  const held = new Promise<void>((resolve) => { releaseSave = resolve; });
  const savedBodies: string[] = [];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route("**/api/projects/save-switch-a/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    savedBodies.push((request.postDataJSON() as { body: string }).body);
    saveStarted();
    await held;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Save switch A" })).toBeVisible();
  await page.getByLabel("Active work").getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  const editorHandle = await editor.elementHandle();
  await editor.fill("Newest content before immediate switch.");
  await page.locator('[data-project-selection="save-switch-b"]').evaluate((button: HTMLElement) => button.click());
  await started;

  await expect(page.getByRole("heading", { name: "Save switch A" })).toBeVisible();
  await expect(editor).toContainText("Newest content before immediate switch.");
  expect(savedBodies).toEqual(["Newest content before immediate switch."]);

  releaseSave();
  await expect(page.getByRole("heading", { name: "Save switch B" })).toBeVisible();
  await expect(editor).toHaveText("Existing draft task.");
  expect(await editorHandle!.evaluate((node) => node.isConnected)).toBe(false);
  expect(savedBodies).toEqual(["Newest content before immediate switch."]);
});

test("failed editor save blocks project switch without discarding content", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const projects = [
    { ...baseProject, id: "failed-switch-a", name: "Failed switch A" },
    { ...baseProject, id: "failed-switch-b", name: "Failed switch B" },
  ];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route("**/api/projects/failed-switch-a/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    const body = (request.postDataJSON() as { body: string }).body;
    if (body === "Saved sibling draft.") return route.fulfill({ status: 204 });
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Draft storage unavailable" }),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Failed switch A" })).toBeVisible();
  await page.getByRole("button", { name: "New task" }).click();
  const siblingSaved = page.waitForResponse((response) => response.url().includes("/draft") && response.request().method() === "PUT" && response.ok());
  await page.getByRole("textbox", { name: "Draft document" }).fill("Saved sibling draft.");
  await siblingSaved;
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  await editor.fill("Keep this content after failed switch.");
  await page.locator('[data-project-selection="failed-switch-b"]').evaluate((button: HTMLElement) => button.click());

  await expect(page.getByRole("alert", { name: "Draft storage unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Failed switch A" })).toBeVisible();
  await expect(editor).toContainText("Keep this content after failed switch.");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Keep this content after failed switch.");
  await expect(page.locator('[data-project-selection="failed-switch-a"]')).toHaveClass(/active/);
});

test("blank task drafts never enter the task list", async ({ page }) => {
  await page.goto("/");
  const before = await page.getByRole("button", { name: /Untitled draft.*draft/i }).count();
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByRole("button", { name: "Close draft: Untitled" }).click();
  await expect(page.getByRole("tab", { name: "Existing draft task." })).toBeFocused();
  await expect(page.getByRole("button", { name: /Untitled draft.*draft/i })).toHaveCount(before);
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
  const dialog = page.getByRole("dialog", { name: /^Conversation with / });
  await dialog.getByRole("textbox").fill("Wake this project only.");
  await dialog.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => fs.existsSync(record)).toBe(true);
});

test("operator messages an individual agent", async ({ page }) => {
  await page.goto("/");
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  const before = messageCount(dbPath);
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  await page.getByRole("dialog", { name: /^Conversation with / }).getByRole("textbox").fill("Confirm the launch order.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => messageCount(dbPath)).toBe(before + 1);
});

test("persisted submissions warn without presenting failure or resubmitting", async ({ page }) => {
  let messageSubmissions = 0;
  let workSubmissions = 0;
  await page.route("**/api/projects/*/messages", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    messageSubmissions += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, workerStarted: false, workerError: "Worker executable missing" }),
    });
  });
  await page.route("**/api/projects/*/draft", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/projects/*/draft/submit", async (route) => {
    workSubmissions += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, workerStarted: false, workerError: "Worker executable missing" }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const composer = page.getByRole("dialog", { name: /^Conversation with / }).getByRole("textbox");
  await composer.fill("Persist this message.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(composer).toHaveValue("");
  await expect(page.getByText(/Submission saved, but agents did not start\./)).toBeVisible();
  await expect(page.getByText("Message failed", { exact: true })).toHaveCount(0);
  expect(messageSubmissions).toBe(1);

  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByRole("textbox", { name: "Task document" }).fill("Persist this work item.");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("textbox", { name: "Task document" })).toHaveText("");
  await expect(page.getByText(/Open system status to restart agents\./)).toBeVisible();
  await expect(page.getByText("Could not send task", { exact: true })).toHaveCount(0);
  expect(workSubmissions).toBe(1);
});

test("message send is optimistic, retryable, and reconciles without duplicates", async ({ page }) => {
  const submissions: string[] = [];
  let attempts = 0;
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/api/projects/*/messages", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    attempts += 1;
    const payload = request.postDataJSON() as { submissionId: string };
    submissions.push(payload.submissionId);
    if (attempts === 1) {
      await firstPending;
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Network unavailable"}' });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: `dashboard-message-${payload.submissionId}`,
        status: "pending",
        workerStarted: false,
        workerError: "Project worker did not start",
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  const composer = dialog.getByRole("textbox", { name: "Message lead" });
  await expect(dialog.getByRole("heading", { name: "lead" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Messages" })).toHaveCount(0);
  await expect(composer).toHaveAttribute("placeholder", "Message Lead");
  await composer.fill("Retry the same optimistic message.");
  await dialog.getByRole("button", { name: "Send message" }).click();

  const bubble = dialog.locator("article", { hasText: "Retry the same optimistic message." });
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText("Sending");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("");

  releaseFirst();
  await expect(bubble).toContainText("Network unavailable");
  await bubble.getByRole("button", { name: "Retry" }).click();
  await expect(bubble).toContainText("Queued, agents not running");
  await expect(bubble).toBeFocused();
  await expect(dialog.locator("article", { hasText: "Retry the same optimistic message." })).toHaveCount(1);
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toBe(submissions[0]);
});

test("message lifecycle and active response remain accessible across refresh", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let phase = "queued";
  const messageTime = new Date().toISOString();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/messages")) {
      failedRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.route("**/api/projects/*", async (route, request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" || !/^\/api\/projects\/[^/]+$/.test(url.pathname)) {
      return route.continue();
    }
    const response = await route.fetch();
    const project = await response.json();
    if (phase === "working") {
      project.agents = project.agents.map((agent) => agent.id === "lead"
        ? { ...agent, status: "working", topic: "dashboard-message", updatedAt: messageTime }
        : agent);
    }
    await route.fulfill({ response, json: project });
  });
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const message = {
      id: "task:dashboard-message-project:lifecycle",
      submissionId: "project:lifecycle",
      sender: "dashboard",
      recipient: "lead",
      body: "Track this durable follow-up.",
      status: phase === "replied" ? "completed" : phase === "failed" ? "failed" : phase === "queued" ? "pending" : "claimed",
      deliveryState: phase,
      error: phase === "failed" ? "Agent session closed" : undefined,
      timestamp: messageTime,
      direction: "incoming",
      kind: "message",
    };
    const reply = {
      id: "turn:42",
      replyToId: message.id,
      sender: "lead",
      recipient: "team",
      body: "Durable follow-up answered.",
      status: "completed",
      deliveryState: "replied",
      timestamp: new Date(Date.parse(messageTime) + 1_000).toISOString(),
      direction: "outgoing",
      kind: "turn",
      title: "Completed turn",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: phase === "replied" ? [message, reply] : [message], hasMore: false }),
    });
  });

  async function openConversation() {
    const trigger = page.getByRole("button", { name: "Open conversation with lead" });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Conversation with lead" });
    await expect(drawer).toBeVisible();
    return drawer;
  }
  await page.goto("/");
  let dialog = await openConversation();
  await expect(dialog.locator("article", { hasText: "Track this durable follow-up." })).toContainText("Queued");

  for (const [next, label] of [["delivered", "Delivered to agent session"], ["working", "Working"], ["replied", "Replied"]]) {
    phase = next;
    await page.reload();
    dialog = await openConversation();
    await expect(dialog.locator("article", { hasText: "Track this durable follow-up." })).toContainText(label);
    if (next === "working") {
      await expect(dialog.getByRole("status", { name: "Lead is responding" })).toHaveCount(1);
      await expect(dialog.getByRole("status", { name: "Lead is responding" })).toBeVisible();
    }
  }
  await expect(dialog.getByText("Durable follow-up answered.", { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("observable-messaging.png"), fullPage: true });
});

test("canonical message reconciliation keeps the server timestamp under client clock skew", async ({ page }) => {
  const canonicalTimestamp = "2020-01-02T03:04:05.000Z";
  let canonical: Record<string, unknown> | undefined;
  let reply: Record<string, unknown> | undefined;
  await page.addInitScript(() => {
    const sources: Array<{ onmessage: ((event: MessageEvent<string>) => void) | null }> = [];
    class MockEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      constructor() { sources.push(this); }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
    (window as typeof window & { emitConversationEvent: () => void }).emitConversationEvent = () => {
      const event = new MessageEvent("message", {
        data: JSON.stringify({ projectId: ".e2e", conversations: ["lead"] }),
      });
      for (const source of sources) source.onmessage?.(event);
    };
  });
  await page.route("**/api/projects/*/messages*", async (route, request) => {
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [canonical, reply].filter(Boolean), hasMore: false }),
      });
    }
    if (request.method() !== "POST") return route.continue();
    const payload = request.postDataJSON() as { agent: string; body: string; submissionId: string };
    canonical = {
      id: `task:dashboard-message-${payload.submissionId}`,
      submissionId: payload.submissionId,
      sender: "dashboard",
      recipient: payload.agent,
      body: payload.body,
      status: "completed",
      deliveryState: "replied",
      timestamp: canonicalTimestamp,
      direction: "incoming",
      kind: "message",
    };
    reply = {
      id: "event:canonical-reply",
      sender: payload.agent,
      recipient: "team",
      body: "Canonical server reply.",
      status: "recorded",
      timestamp: "2020-01-02T03:04:06.000Z",
      direction: "outgoing",
      kind: "assistant",
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: `dashboard-message-${payload.submissionId}`,
        status: "pending",
        workerStarted: true,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await dialog.getByRole("textbox", { name: "Message lead" }).fill("Use the canonical server clock.");
  await dialog.getByRole("button", { name: "Send message" }).click();
  const bubble = dialog.locator("article", { hasText: "Use the canonical server clock." });
  await expect(bubble).toHaveCount(1);
  await expect(bubble.locator("time")).toHaveAttribute("datetime", canonicalTimestamp);
  await expect(bubble).toContainText("Replied");
  await expect(dialog.getByText("Canonical server reply.", { exact: true })).toBeVisible();

  canonical = undefined;
  await page.evaluate(() => (window as typeof window & { emitConversationEvent: () => void }).emitConversationEvent());
  await expect(dialog.locator("article", { hasText: "Use the canonical server clock." })).toHaveCount(0);
  await expect(dialog.getByText("Queued", { exact: true })).toHaveCount(0);
});

test("conversation drawer remains usable across narrow and zoom-equivalent viewports", async ({ page }, testInfo) => {
  const projectsResponse = await page.request.get("/api/projects");
  const projects = await projectsResponse.json() as Array<Record<string, unknown>>;
  const project = projects[0];
  const agents = project.agents as Array<Record<string, unknown>>;
  const lead = agents.find((agent) => agent.id === "lead")!;
  const timestamp = new Date(Date.now() - 1_000).toISOString();
  let sends = 0;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (["fetch", "xhr"].includes(request.resourceType())) {
      failedRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        ...project,
        agents: agents.map((agent) => agent.id === "lead"
          ? { ...lead, status: "working", topic: "dashboard-message", updatedAt: new Date().toISOString() }
          : agent),
      }]),
    });
  });
  await page.route("**/api/projects/*/messages*", async (route, request) => {
    if (request.method() === "POST") {
      sends += 1;
      const payload = request.postDataJSON() as { submissionId: string };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, id: `dashboard-message-${payload.submissionId}`, status: "pending", workerStarted: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          id: "responsive-operator",
          sender: "dashboard",
          recipient: "lead",
          body: "Responsive operator message.",
          status: "pending",
          timestamp,
          direction: "incoming",
          kind: "message",
        }],
        hasMore: false,
      }),
    });
  });

  for (const scenario of [
    { width: 320, height: 720, label: "640px at 200% zoom", reducedMotion: true },
    { width: 390, height: 844, label: "390x844 mobile", reducedMotion: false },
    { width: 620, height: 720, label: "620px", reducedMotion: false },
  ]) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion ? "reduce" : "no-preference" });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open conversation with lead" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Conversation with Lead" });
    const composer = dialog.getByRole("textbox", { name: "Message Lead" });
    const send = dialog.getByRole("button", { name: "Send message" });
    await expect(composer).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(composer).toBeFocused();
    const working = dialog.getByRole("status", { name: "Lead is responding" });
    const visualResponse = dialog.locator('div[aria-hidden="true"]', { hasText: "Lead is responding" });
    await expect(working).toHaveCount(1);
    await expect(working).toBeVisible();
    await expect(visualResponse).toBeVisible();
    await expect(dialog.getByText(/typing/i)).toHaveCount(0);
    await expect(dialog).toHaveCSS("transform", "none");
    const [dialogBox, composerBox, sendBox, pageWidth] = await Promise.all([
      dialog.boundingBox(),
      composer.boundingBox(),
      send.boundingBox(),
      page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth })),
    ]);
    expect(dialogBox, `${scenario.label} dialog`).not.toBeNull();
    expect(dialogBox!.x, `${scenario.label} dialog left`).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width, `${scenario.label} dialog right`).toBeLessThanOrEqual(scenario.width);
    expect(composerBox!.width, `${scenario.label} composer width`).toBeGreaterThan(0);
    expect(sendBox!.width, `${scenario.label} send width`).toBeGreaterThanOrEqual(44);
    expect(sendBox!.height, `${scenario.label} send height`).toBeGreaterThanOrEqual(44);
    expect(pageWidth.pageWidth, `${scenario.label} horizontal overflow`).toBeLessThanOrEqual(pageWidth.viewportWidth);
    await composer.fill(Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join("\n"));
    const composerHeight = await composer.evaluate((node) => node.getBoundingClientRect().height);
    expect(composerHeight, `${scenario.label} composer minimum`).toBeGreaterThanOrEqual(44);
    expect(composerHeight, `${scenario.label} composer maximum`).toBeLessThanOrEqual(128);
    await page.keyboard.press("Tab");
    await expect(send).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(composer).toBeFocused();
    if (scenario.reducedMotion) {
      await expect(visualResponse.locator("span").last()).toHaveCSS("animation-name", "none");
      await expect(dialog).toHaveCSS("animation-name", "none");
    }
    if (scenario.width === 320) {
      await composer.fill("IME-safe message");
      await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true, isComposing: true });
      expect(sends).toBe(0);
      await expect(composer).toHaveValue("IME-safe message");
      await composer.press("Control+Enter");
      expect(sends).toBe(1);
      await expect(composer).toHaveValue("");
    }
    if (scenario.width === 390) {
      const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("observable-messaging-mobile-390x844.png"), fullPage: true });
    }
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(trigger).toBeFocused();
  }
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("saved project capacity controls real submitted work", async ({ page }) => {
  const projectPath = path.join(process.cwd(), ".e2e", "project.json");
  const dbPath = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "harness.db");
  const originalProject = readFileSync(projectPath, "utf8");
  const submitted = ["Capacity browser one", "Capacity browser two", "Capacity browser three"];
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE tasks SET status='completed',completed_at=?
    WHERE kind='root' AND source='manual' AND assignee='lead'
    AND topic='work-item' AND status IN ('pending','claimed','waiting','deferred','backlog')`)
    .run("2026-07-15T20:00:00Z");
  db.close();

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Configure limits" }).click();
    const dialog = page.getByRole("dialog", { name: "Project workflow" });
    await expect(dialog.getByRole("heading", { name: "Active project work" })).toBeVisible();
    await expect(dialog.getByText("Chat, delegated work, and generated ideas do not use these slots.")).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Leader delegation" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Idea generation" })).toBeVisible();
    await dialog.getByRole("spinbutton", { name: "Maximum active work items" }).fill("2");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    for (const body of submitted) {
      const response = await page.request.post("/api/projects/.e2e/work-items", { data: { body } });
      expect(response.ok()).toBe(true);
    }

    await expect.poll(() => {
      const check = new DatabaseSync(dbPath, { readOnly: true });
      const rows = check.prepare(`SELECT body,status FROM tasks WHERE body IN (?,?,?) ORDER BY created_at,id`)
        .all(...submitted).map((row) => ({ ...row }));
      check.close();
      return rows;
    }).toEqual([
      { body: submitted[0], status: expect.stringMatching(/^(pending|claimed|waiting|deferred)$/) },
      { body: submitted[1], status: expect.stringMatching(/^(pending|claimed|waiting|deferred)$/) },
      { body: submitted[2], status: "backlog" },
    ]);

    expect(JSON.parse(readFileSync(projectPath, "utf8")).max_active_tasks).toBe(2);
  } finally {
    writeFileSync(projectPath, originalProject);
    const cleanup = new DatabaseSync(dbPath);
    cleanup.prepare("DELETE FROM tasks WHERE body IN (?,?,?)").run(...submitted);
    cleanup.prepare("UPDATE root_task_policy SET max_active_tasks=0,leader='lead' WHERE singleton=1").run();
    cleanup.close();
  }
});

test("conversation drawer focuses the composer and restores its opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open conversation with lead" });
  await opener.click();
  const composer = page.getByRole("dialog", { name: /^Conversation with / }).getByRole("textbox", { name: "Message lead" });
  await expect(composer).toBeFocused();
  await page.keyboard.type("Typed without moving focus.");
  await expect(composer).toHaveValue("Typed without moving focus.");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
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
  const history = page.getByRole("log", { name: "Conversation history with lead" });
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  await expect(dialog.getByText("Task assigned", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Delegated task", { exact: true })).toHaveCount(0);
  const assignment = dialog.locator('[data-chat-id="task:work-message"]');
  const paragraphs = assignment.locator("p");
  await expect(paragraphs).toHaveCount(1);
  expect(await paragraphs.first().evaluate((node) => getComputedStyle(node.parentElement as HTMLElement).display)).not.toBe("flex");
});

test("agent chat separates prose, events, and grouped tool outcomes", async ({ page }) => {
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const items = [
      {
        id: "ux:prose",
        sender: "lead",
        recipient: "team",
        body: "This is a deliberately long agent response that verifies the conversation uses a readable prose size, comfortable line height, and bounded line length without hiding its timestamp.",
        status: "completed",
        timestamp: "2026-07-15T16:10:00.000Z",
        direction: "outgoing",
        kind: "assistant",
      },
      {
        id: "ux:tool:1",
        sender: "lead",
        recipient: "cairn-harness-search",
        body: "Found three matching files.",
        status: "recorded",
        timestamp: "2026-07-15T16:11:00.000Z",
        direction: "outgoing",
        kind: "tool",
        title: "Used search",
      },
      {
        id: "ux:tool:2",
        sender: "lead",
        recipient: "cairn-harness-update",
        body: "Permission denied while updating the record.",
        status: "failed",
        timestamp: "2026-07-15T16:12:00.000Z",
        direction: "outgoing",
        kind: "tool",
        title: "Used update",
      },
      {
        id: "ux:event",
        sender: "lead",
        recipient: "team",
        body: "Completed the focused implementation.",
        status: "completed",
        timestamp: "2026-07-15T16:13:00.000Z",
        direction: "outgoing",
        kind: "turn",
        title: "Completed turn",
      },
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, hasMore: false }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const history = page.getByRole("log", { name: "Conversation history with lead" });
  const prose = history.locator('[data-chat-id="ux:prose"] p');
  await expect(prose).toBeVisible();
  const proseStyle = await prose.evaluate((node) => {
    const style = getComputedStyle(node);
    return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
  });
  expect(proseStyle.fontSize).toBeGreaterThanOrEqual(14);
  expect(proseStyle.lineHeight / proseStyle.fontSize).toBeGreaterThanOrEqual(1.5);
  expect(await history.locator('[data-chat-id="ux:prose"]').evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(704);
  await expect(history.getByLabel("Agent result from lead")).toBeVisible();
  const proseTime = history.locator('[data-chat-id="ux:prose"] time');
  await expect(proseTime).toBeVisible();
  await expect(proseTime).toHaveCSS("opacity", "1");

  const tools = history.getByText("Tools used (2)", { exact: true });
  await expect(tools).toBeVisible();
  await tools.click();
  await expect(history.getByText("Search", { exact: true })).toBeVisible();
  await expect(history.getByText("Update", { exact: true })).toBeVisible();
  await expect(history.getByText("Failed", { exact: true })).toBeVisible();
  await expect(history.getByText("Permission denied while updating the record.", { exact: true })).toBeVisible();
});

test("conversation load failures are retryable", async ({ page }) => {
  const projectsResponse = await page.request.get("/api/projects");
  const projects = await projectsResponse.json() as Array<{ id: string }>;
  const projectId = projects[0].id;
  const successfulResponse = await page.request.get(`/api/projects/${projectId}/messages?agent=builder`);
  const successfulBody = await successfulResponse.text();
  let historyRequests = 0;
  let releaseRetry!: () => void;
  const retryPending = new Promise<void>((resolve) => { releaseRetry = resolve; });
  await page.route("**/api/projects/*/messages?agent=builder*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    historyRequests += 1;
    if (historyRequests === 1) {
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Conversation unavailable"}' });
    }
    if (historyRequests === 2) await retryPending;
    return route.fulfill({ status: 200, contentType: "application/json", body: successfulBody });
  });

  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open conversation with builder" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /^Conversation with / });
  const composer = dialog.getByRole("textbox", { name: "Message builder" });
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("Could not load conversation");
  await composer.fill("Keep this draft while history retries.");

  await dialog.getByRole("button", { name: "Retry" }).click();
  const retrying = dialog.getByRole("button", { name: "Retrying…" });
  await expect(retrying).toBeDisabled();
  await expect.poll(() => historyRequests).toBe(2);
  await retrying.evaluate((button) => button.click());
  await page.keyboard.press("Enter");
  expect(historyRequests).toBe(2);
  await expect(composer).toHaveValue("Keep this draft while history retries.");
  releaseRetry();

  await expect(alert).toHaveCount(0);
  await expect(dialog.getByLabel("Conversation history with builder")).toBeVisible();
  await expect(dialog.getByText("Should the launch include mobile?")).toBeVisible();
  await expect(composer).toHaveValue("Keep this draft while history retries.");
});

test("todo and activity rows open their full source context", async ({ page }) => {
  await page.route("**/api/projects/*/messages?*", async (route, request) => {
    const url = new URL(request.url());
    const focusId = url.searchParams.get("focus");
    if (!focusId) return route.continue();
    const agent = url.searchParams.get("agent") || "";
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: index === 20 ? focusId : `${focusId}:context:${index}`,
      sender: "lead",
      recipient: agent,
      body: index === 20
        ? focusId === "turn:1" ? "Delegated launch work." : "Build the launch page."
        : `Conversation context ${index + 1}`,
      status: "completed",
      timestamp: new Date(Date.UTC(2026, 6, 13, 12, index)).toISOString(),
      direction: "incoming",
      kind: index === 20 && focusId === "turn:1" ? "turn" : "message",
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        hasMore: false,
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Build the launch page.*Builder.*Queued/ }).first().click();
  const delegated = page.getByRole("dialog", { name: /^Conversation with / });
  const sent = delegated.locator('[data-chat-id="task:mtodo"]');
  await expect(sent).toBeVisible();
  await expect(sent).toBeFocused();
  await page.waitForTimeout(400);
  await expect(sent).toBeFocused();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /Delegated launch work/ }).click();
  const chat = page.getByRole("dialog", { name: /^Conversation with / });
  const turn = chat.locator('[data-chat-id="turn:1"]');
  await expect(turn).toBeVisible();
  await expect(turn).toBeFocused();
  await page.waitForTimeout(400);
  await expect(turn).toBeFocused();
  const history = page.getByLabel("Conversation history with lead");
  await history.evaluate((node) => node.scrollTo({ top: 0 }));
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBe(0);
  await history.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
});

test("in-progress task opens the agent's latest conversation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Prepare and ship the launch.*Running/ }).click();
  const chat = page.getByRole("dialog", { name: "Conversation with lead" });
  await expect(chat.getByRole("button", { name: "Return to latest" })).toHaveCount(0);
  await expect(chat.getByRole("textbox", { name: "Message lead" })).toBeFocused();
  const history = page.getByLabel("Conversation history with lead");
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
});

test("completed roots stay available in collapsed work history", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Research the launch audience.*Completed/ })).toHaveCount(0);
  await page.getByText(/^History \(\d+\)$/).click();
  await expect(page.getByRole("button", { name: /Research the launch audience.*Completed/ })).toBeVisible();
});

test("completed delegated work stays collapsed while root progress includes it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Build the launch page.*Completed/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Prepare and ship the launch.*1 of 2 delegated complete/ })).toBeVisible();
  await page.getByText(/^History \(\d+\)$/).click();
  const children = page.getByRole("list", { name: "Historical delegations" });
  await expect(children.getByRole("button", { name: /Build the launch page.*Completed/ })).toHaveCount(1);
});

test("project folder picker is single-flight", async ({ page }) => {
  let folderRequests = 0;
  let projectCreations = 0;
  let releasePicker!: () => void;
  const pickerPending = new Promise<void>((resolve) => { releasePicker = resolve; });

  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/projects") projectCreations += 1;
  });
  await page.route("**/api/folders", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    folderRequests += 1;
    await pickerPending;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: "C:\\Projects\\single-flight" }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill("Single-flight project");
  const browse = dialog.getByRole("button", { name: "Workspace" });
  await browse.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect.poll(() => folderRequests).toBe(1);
  await expect(browse).toBeDisabled();
  await expect(browse).toContainText("Opening…");
  await expect(dialog.getByRole("button", { name: /Continue/ })).toBeDisabled();
  expect(projectCreations).toBe(0);

  releasePicker();
  await expect(browse).toBeEnabled();
  await expect(browse).toContainText("C:\\Projects\\single-flight");
  await expect(dialog.getByRole("button", { name: /Continue/ })).toBeEnabled();
  expect(folderRequests).toBe(1);
  expect(projectCreations).toBe(0);
});

test("successful project creation survives a failed projects refresh", async ({ page }) => {
  const projectId = "created-before-refresh-failure";
  const color = "#336699";
  let projectPosts = 0;
  let projectRefreshes = 0;
  let created = false;

  await page.route("**/api/folders", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: "C:\\Projects\\refresh-failure" }),
    });
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() === "POST") {
      projectPosts += 1;
      created = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: projectId }),
      });
    }
    if (request.method() === "GET" && created) {
      projectRefreshes += 1;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Project refresh temporarily unavailable."}',
      });
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill("Refresh failure project");
  await dialog.getByRole("button", { name: "Workspace" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByLabel("Refresh failure project color").fill(color);
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(dialog.getByText("Project ready", { exact: true })).toBeVisible();
  await expect(page.locator("p[role='alert']")).toContainText("Dashboard data may be out of date. Project refresh temporarily unavailable.");
  expect(projectPosts).toBe(1);
  expect(projectRefreshes).toBe(1);
  expect(await page.evaluate((id) => ({
    selected: localStorage.getItem("harness-selected-project"),
    color: JSON.parse(localStorage.getItem("harness-project-colors") || "{}")[id],
  }), projectId)).toEqual({ selected: projectId, color });
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
  await page.route("**/draft/submit", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Disk unavailable"}' }));
  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  const textbox = page.getByRole("textbox", { name: "Task document" });
  await textbox.fill("Preserve this request.");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Disk unavailable" })).toBeVisible();
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

test("avatar processing is single-flight and retryable", async ({ page }) => {
  const projects = await (await page.request.get("/api/projects")).json() as Array<{ id: string }>;
  const appearanceKey = JSON.stringify([projects[0].id, "lead"]);
  await page.addInitScript(() => {
    type AvatarTestWindow = Window & { __avatarDecodeCalls: number; __releaseAvatarDecode?: () => void };
    const testWindow = window as AvatarTestWindow;
    if (!localStorage.getItem("harness-agent-colors")) localStorage.setItem("harness-agent-colors", JSON.stringify({ lead: "#112233" }));
    if (!localStorage.getItem("harness-agent-avatars")) localStorage.setItem("harness-agent-avatars", JSON.stringify({ lead: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" }));
    const original = window.createImageBitmap.bind(window);
    testWindow.__avatarDecodeCalls = 0;
    window.createImageBitmap = (async (source: ImageBitmapSource) => {
      testWindow.__avatarDecodeCalls += 1;
      if (testWindow.__avatarDecodeCalls === 2) {
        await new Promise<void>((resolve) => { testWindow.__releaseAvatarDecode = resolve; });
        throw new Error("Forced avatar processing failure");
      }
      return original(source);
    }) as typeof window.createImageBitmap;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  const color = page.getByLabel("lead color");
  const picture = page.getByRole("button", { name: "Picture", exact: true });
  const preview = page.getByRole("img", { name: "lead picture preview" });
  const image = path.join(process.cwd(), "..", "docs", "dashboard.png");
  await expect(color).toHaveValue("#112233");
  await color.fill("#ff9900");
  await picture.setInputFiles(image);
  await expect.poll(() => preview.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("data:image/webp");
  await expect(picture).toBeEnabled();
  const persistedAvatar = await preview.evaluate((node) => getComputedStyle(node).backgroundImage);
  const storedAppearance = await page.evaluate(() => ({
    colors: JSON.parse(localStorage.getItem("harness-agent-colors") || "{}") as Record<string, string>,
    avatars: JSON.parse(localStorage.getItem("harness-agent-avatars") || "{}") as Record<string, string>,
  }));
  expect(storedAppearance.colors.lead).toBe("#112233");
  expect(storedAppearance.colors[appearanceKey]).toBe("#ff9900");
  expect(storedAppearance.avatars.lead).toContain("data:image/svg+xml");
  expect(storedAppearance.avatars[appearanceKey]).toContain("data:image/webp");

  await picture.setInputFiles(image);
  await expect(page.getByText("Preparing picture", { exact: true })).toBeVisible();
  const remove = page.getByRole("button", { name: "Remove picture" });
  await expect(picture).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as Window & { __avatarDecodeCalls: number }).__avatarDecodeCalls)).toBe(2);
  await page.evaluate(() => (window as Window & { __releaseAvatarDecode?: () => void }).__releaseAvatarDecode?.());
  const processingError = page.getByText("Forced avatar processing failure", { exact: true });
  await expect(processingError).toBeVisible();
  await expect(picture).toBeEnabled();
  await expect(remove).toBeEnabled();
  await expect.poll(() => preview.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe(persistedAvatar);

  await picture.setInputFiles(image);
  await expect.poll(() => page.evaluate(() => (window as Window & { __avatarDecodeCalls: number }).__avatarDecodeCalls)).toBe(3);
  await expect(processingError).toHaveCount(0);
  await expect.poll(() => preview.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("data:image/webp");
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  const avatar = page.getByLabel("Project leader").locator("..");
  await expect.poll(() => avatar.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("data:image/webp");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  await expect(page.getByLabel("lead color")).toHaveValue("#ff9900");
});

test("agent appearance stays scoped when projects share an agent id", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const baseline = await response.json() as Array<Record<string, unknown>>;
  const baseProject = baseline[0];
  const delegatedActions = (baseProject.delegatedActions as Array<Record<string, unknown>>)
    .map((item, index) => index === 0 ? { ...item, agentId: "lead" } : item);
  const projects = [
    { ...baseProject, id: "appearance-project-a", name: "Appearance project A", root: "C:\\Projects\\appearance-a", delegatedActions },
    { ...baseProject, id: "appearance-project-b", name: "Appearance project B", root: "C:\\Projects\\appearance-b", delegatedActions },
  ];
  const legacyColor = "#667788";
  const legacyAvatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const projectAColor = "#e15b64";
  const projectBColor = "#3578e5";
  const projectAKey = JSON.stringify(["appearance-project-a", "lead"]);
  const projectBKey = JSON.stringify(["appearance-project-b", "lead"]);
  const projectAImage = path.join(process.cwd(), "..", "docs", "dashboard.png");

  await page.addInitScript(({ color, avatar }) => {
    if (sessionStorage.getItem("appearance-scope-seeded")) return;
    localStorage.setItem("harness-agent-colors", JSON.stringify({ lead: color }));
    localStorage.setItem("harness-agent-avatars", JSON.stringify({ lead: avatar }));
    sessionStorage.setItem("appearance-scope-seeded", "true");
  }, { color: legacyColor, avatar: legacyAvatar });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });
  await page.route(/\/api\/projects\/appearance-project-[ab]\/messages\?agent=lead/, async (route) => {
    const projectId = route.request().url().includes("appearance-project-a") ? "a" : "b";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          id: `appearance-chat-${projectId}`,
          sender: "lead",
          recipient: "dashboard",
          body: `Scoped appearance message ${projectId.toUpperCase()}`,
          status: "completed",
          timestamp: "2026-07-15T12:00:00Z",
          direction: "incoming",
          kind: "assistant",
        }],
        hasMore: false,
      }),
    });
  });

  const setAppearance = async (color: string, image?: string) => {
    await page.getByRole("button", { name: "More options for lead" }).click();
    await page.getByRole("menuitem", { name: "Appearance" }).click();
    await page.getByLabel("lead color").fill(color);
    if (image) {
      await page.getByRole("button", { name: "lead picture" }).setInputFiles(image);
      const preview = page.getByRole("img", { name: "lead picture preview" });
      await expect.poll(() => preview.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("data:image/webp");
    }
    await page.getByRole("button", { name: "Close" }).click();
  };
  const identity = async (project: "a" | "b") => {
    const opener = page.getByRole("button", { name: "Open conversation with lead" });
    const card = opener.locator("..");
    const cardAvatar = card.getByLabel("Project leader").locator("..");
    const delegation = page.locator("section")
      .filter({ has: page.getByRole("heading", { name: "Work" }) })
      .getByRole("button")
      .filter({ hasText: "Executor:" })
      .first();
    const delegationAvatar = delegation.locator("span").first();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: /^Conversation with / });
    const message = dialog.locator(`[data-chat-id="appearance-chat-${project}"]`);
    await expect(message).toBeVisible();
    const chatAvatar = message.locator("span").first();
    const result = {
      cardColor: await card.evaluate((node) => getComputedStyle(node).getPropertyValue("--agent-color").trim()),
      cardAvatar: await cardAvatar.evaluate((node) => getComputedStyle(node).backgroundImage),
      delegationColor: await delegation.evaluate((node) => getComputedStyle(node).getPropertyValue("--todo-color").trim()),
      delegationAvatar: await delegationAvatar.evaluate((node) => getComputedStyle(node).backgroundImage),
      chatColor: await message.evaluate((node) => getComputedStyle(node).getPropertyValue("--sender-color").trim()),
      chatAvatar: await chatAvatar.evaluate((node) => getComputedStyle(node).backgroundImage),
    };
    await dialog.getByRole("button", { name: "Close" }).click();
    return result;
  };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Appearance project A" })).toBeVisible();
  await setAppearance(projectAColor, projectAImage);
  const projectAIdentity = await identity("a");
  expect(projectAIdentity.cardColor).toBe(projectAColor);
  expect(projectAIdentity.delegationColor).toBe(projectAColor);
  expect(projectAIdentity.chatColor).toBe(projectAColor);

  await page.getByRole("button", { name: /Appearance project B.*tasks/ }).click();
  await expect(page.getByRole("heading", { name: "Appearance project B" })).toBeVisible();
  const unchangedProjectBIdentity = await identity("b");
  expect(unchangedProjectBIdentity.cardColor).toBe(legacyColor);
  expect(unchangedProjectBIdentity.delegationColor).toBe(legacyColor);
  expect(unchangedProjectBIdentity.chatColor).toBe(legacyColor);
  expect(unchangedProjectBIdentity.cardAvatar).toContain("data:image/png;base64");
  expect(unchangedProjectBIdentity.delegationAvatar).toContain("data:image/png;base64");
  expect(unchangedProjectBIdentity.chatAvatar).toContain("data:image/png;base64");

  await setAppearance(projectBColor);
  const projectBIdentity = await identity("b");
  expect(projectBIdentity.cardColor).toBe(projectBColor);
  expect(projectBIdentity.delegationColor).toBe(projectBColor);
  expect(projectBIdentity.chatColor).toBe(projectBColor);
  expect(projectBIdentity.cardAvatar).not.toBe(projectAIdentity.cardAvatar);

  const stored = await page.evaluate(() => ({
    colors: JSON.parse(localStorage.getItem("harness-agent-colors") || "{}") as Record<string, string>,
    avatars: JSON.parse(localStorage.getItem("harness-agent-avatars") || "{}") as Record<string, string>,
  }));
  expect(stored.colors).toMatchObject({
    lead: legacyColor,
    [projectAKey]: projectAColor,
    [projectBKey]: projectBColor,
  });
  expect(stored.avatars.lead).toBe(legacyAvatar);
  expect(stored.avatars[projectAKey]).toBeTruthy();
  expect(stored.avatars[projectBKey]).toBeUndefined();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Appearance project B" })).toBeVisible();
  expect(await identity("b")).toEqual(projectBIdentity);
  await page.getByRole("button", { name: /Appearance project A.*tasks/ }).click();
  await expect(page.getByRole("heading", { name: "Appearance project A" })).toBeVisible();
  expect(await identity("a")).toEqual(projectAIdentity);
});

test("agent instruction save status tracks unsaved edits", async ({ page }, testInfo) => {
  let promptRequests = 0;
  let releaseFirstSave!: () => void;
  const firstSavePending = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    promptRequests += 1;
    await firstSavePending;
    return route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  const editor = page.getByRole("textbox", { name: "Instructions" });
  const drawer = page.getByRole("dialog", { name: /Configure agent/ });
  await expect(drawer.getByRole("button", { name: "Save configuration" })).toHaveCount(0);
  await expect(drawer.getByText("Changes save automatically", { exact: true })).toBeVisible();

  const savedPrompt = `Lead the project and verify every result for ${testInfo.project.name}.`;
  await editor.fill(savedPrompt);
  await expect.poll(() => promptRequests).toBe(1);
  await expect(drawer.getByRole("status")).toHaveText("Saving changes…");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeVisible();
  releaseFirstSave();
  await expect(drawer).toHaveCount(0);
  expect(promptRequests).toBe(1);
  const fixture = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const config = JSON.parse((await import("node:fs")).readFileSync(path.join(process.cwd(), fixture, "project.json"), "utf8")) as { roles: { name: string; prompt: string }[] };
  expect(config.roles.find((role) => role.name === "lead")?.prompt).toContain("verify every result");
});

test("invalid agent edits veto drawer close and focus the first required field", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    writes.push(request.postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  const drawer = page.getByRole("dialog", { name: /Configure agent/ });
  const title = drawer.getByLabel("Title");
  await title.fill("");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Title is required.", { exact: true })).toBeVisible();
  await expect(title).toBeFocused();

  await title.fill("Principal");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toHaveCount(0);
  expect(writes).toContainEqual({ details: { title: "Principal", description: "Project lead" } });
});

test("agent drawer settles fully inside narrow viewports", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "More options for lead" });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Configure source" }).click();
    const drawer = page.getByRole("dialog", { name: /Configure source/ });
    await expect(drawer).toHaveCSS("transform", "none");
    await expect(drawer).toBeInViewport();
    await expect(drawer.getByRole("heading").first()).toBeFocused();
    const bounds = await drawer.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    const close = drawer.getByRole("button", { name: "Close" });
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.locator(":focus")).toHaveCount(1);
    await expect(close).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("agent configuration is scoped to the selected project", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const baseAgents = baseProject.agents as Array<Record<string, unknown>>;
  const projectA = {
    ...baseProject,
    id: "prompt-project-a",
    name: "Prompt project A",
    agents: baseAgents.map((agent) => agent.id === "lead" ? { ...agent, prompt: "Project A prompt" } : agent),
  };
  const projectB = {
    ...baseProject,
    id: "prompt-project-b",
    name: "Prompt project B",
    agents: baseAgents.map((agent) => agent.id === "lead" ? { ...agent, prompt: "Project B prompt" } : agent),
  };
  const saves: Array<{ url: string; body: unknown }> = [];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([projectA, projectB]),
    });
  });
  await page.route("**/api/projects/*/agents/lead", async (route, request) => {
    if (request.method() !== "PUT") return route.continue();
    saves.push({ url: request.url(), body: request.postDataJSON() });
    return route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  const editor = page.getByRole("textbox", { name: "Instructions" });
  await expect(editor).toHaveValue("Project A prompt");
  await editor.fill("Unsaved project A prompt");

  await page.locator('[data-project-selection="prompt-project-b"]').evaluate((button: HTMLElement) => button.click());
  await expect(page.getByRole("heading", { name: "Prompt project B" })).toBeVisible();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "More options for lead" }).click();
  await page.getByRole("menuitem", { name: "Configure agent" }).click();
  const projectBEditor = page.getByRole("textbox", { name: "Instructions" });
  await expect(projectBEditor).toHaveValue("Project B prompt");
  await projectBEditor.fill("Saved project B prompt");
  await page.getByRole("dialog", { name: /Configure agent/ }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: /Configure agent/ })).toHaveCount(0);

  expect(saves).toEqual([
    {
      url: expect.stringContaining("/api/projects/prompt-project-a/agents/lead"),
      body: { instructions: { prompt: "Unsaved project A prompt" } },
    },
    {
      url: expect.stringContaining("/api/projects/prompt-project-b/agents/lead"),
      body: { instructions: { prompt: "Saved project B prompt" } },
    },
  ]);
});

test("new agent draft is scoped to the project that opened it", async ({ page }) => {
  const response = await page.request.get("/api/projects");
  const [baseProject] = await response.json() as Array<Record<string, unknown>>;
  const projectA = { ...baseProject, id: "agent-project-a", name: "Agent project A" };
  const projectB = { ...baseProject, id: "agent-project-b", name: "Agent project B", agents: [] };
  const creates: Array<{ url: string; body: unknown }> = [];
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([projectA, projectB]),
    });
  });
  await page.route("**/api/projects/*/agents", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    creates.push({ url: request.url(), body: request.postDataJSON() });
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"id":"project-b-agent"}' });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agent project A" })).toBeVisible();
  await page.getByRole("button", { name: "New agent" }).click();
  const dialog = page.getByRole("dialog", { name: "New agent" });
  await dialog.getByLabel("Name").fill("Project A agent");
  await dialog.getByLabel("Role").fill("Project A role");
  await dialog.getByLabel("Instructions").fill("Project A instructions");

  await page.locator('[data-project-selection="agent-project-b"]').evaluate((button: HTMLElement) => button.click());
  await expect(page.getByRole("heading", { name: "Agent project B" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Create leader" }).click();
  const projectBDialog = page.getByRole("dialog", { name: "New agent" });
  await expect(projectBDialog.getByText("The first agent becomes project lead.")).toBeVisible();
  await expect(projectBDialog.getByLabel("Name")).toHaveValue("");
  await expect(projectBDialog.getByLabel("Role")).toHaveValue("");
  await expect(projectBDialog.getByLabel("Instructions")).toHaveValue("");
  await projectBDialog.getByLabel("Name").fill("Project B agent");
  await projectBDialog.getByLabel("Role").fill("Project B role");
  await projectBDialog.getByLabel("Instructions").fill("Project B instructions");
  await projectBDialog.getByRole("button", { name: "Create agent" }).click();
  await expect(projectBDialog).toHaveCount(0);

  expect(creates).toEqual([{
    url: expect.stringContaining("/api/projects/agent-project-b/agents"),
    body: { name: "Project B agent", description: "Project B role", prompt: "Project B instructions" },
  }]);
});

test("new agent form submits from the keyboard", async ({ page }, testInfo) => {
  let agentRequests = 0;
  let releaseCreation!: () => void;
  const creationPending = new Promise<void>((resolve) => { releaseCreation = resolve; });
  await page.route("**/api/projects/*/agents", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    agentRequests += 1;
    await creationPending;
    return route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New agent" }).click();
  const dialog = page.getByRole("dialog", { name: "New agent" });
  const name = dialog.getByLabel("Name");
  const role = dialog.getByLabel("Role");
  const instructions = dialog.getByLabel("Instructions");
  await name.press("Enter");
  expect(agentRequests).toBe(0);

  const agentName = `Keyboard ${testInfo.project.name}`;
  await name.fill(agentName);
  await role.fill("Keyboard test agent");
  await instructions.fill("Create work from keyboard submissions.");
  await instructions.press("Enter");
  await expect(instructions).toHaveValue("Create work from keyboard submissions.\n");
  expect(agentRequests).toBe(0);

  await name.press("Enter");
  const creating = dialog.getByRole("button", { name: "Creating" });
  await expect(creating).toBeDisabled();
  await expect.poll(() => agentRequests).toBe(1);
  await name.press("Enter");
  await creating.evaluate((button) => button.click());
  expect(agentRequests).toBe(1);
  releaseCreation();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: agentName, exact: true })).toBeVisible();
});

test("failed agent actions remain retryable and single-flight", async ({ page }) => {
  let releasePauseFailure!: () => void;
  const pauseFailurePending = new Promise<void>((resolve) => { releasePauseFailure = resolve; });
  let pauseFailureStarted!: () => void;
  const firstPause = new Promise<void>((resolve) => { pauseFailureStarted = resolve; });
  let releasePauseSuccess!: () => void;
  const pauseSuccessPending = new Promise<void>((resolve) => { releasePauseSuccess = resolve; });
  let pauseSuccessStarted!: () => void;
  const secondPause = new Promise<void>((resolve) => { pauseSuccessStarted = resolve; });
  let releaseClearFailure!: () => void;
  const clearFailurePending = new Promise<void>((resolve) => { releaseClearFailure = resolve; });
  let clearFailureStarted!: () => void;
  const firstClear = new Promise<void>((resolve) => { clearFailureStarted = resolve; });
  const actions: string[] = [];
  let deleteRequests = 0;
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/api/projects/*/agents/builder", async (route, request) => {
    if (request.method() === "DELETE") {
      deleteRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (request.method() !== "PATCH") return route.continue();
    const { action } = request.postDataJSON() as { action: string };
    actions.push(action);
    if (action === "pause" && actions.filter((value) => value === "pause").length === 1) {
      pauseFailureStarted();
      await pauseFailurePending;
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Agent pause unavailable"}' });
    }
    if (action === "pause") {
      pauseSuccessStarted();
      await pauseSuccessPending;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (action === "clear-context") {
      clearFailureStarted();
      await clearFailurePending;
      return route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Context is still in use"}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "More options for builder" });
  await trigger.click();
  let menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name: "Pause agent" }).click();
  await firstPause;

  const pausing = menu.getByRole("menuitem", { name: "Pausing agent" });
  const makeLeader = menu.getByRole("menuitem", { name: "Make project lead" });
  const clear = menu.getByRole("menuitem", { name: "Restart session" });
  const deleteAgent = menu.getByRole("menuitem", { name: "Delete agent" });
  await expect(menu).toHaveAttribute("aria-busy", "true");
  for (const item of [makeLeader, pausing, clear, deleteAgent]) {
    await expect(item).toHaveAttribute("aria-disabled", "true");
  }
  await pausing.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Configure agent" })).toBeFocused();
  await pausing.evaluate((button: HTMLButtonElement) => button.click());
  expect(actions).toEqual(["pause"]);
  expect(deleteRequests).toBe(0);

  releasePauseFailure();
  const pauseAlert = menu.getByRole("alert");
  await expect(pauseAlert).toHaveText("Agent pause unavailable");
  const retryPause = menu.getByRole("menuitem", { name: "Pause agent" });
  await expect(retryPause).toBeFocused();
  await expect(retryPause).toHaveAttribute("aria-describedby", /agent-action-error/);
  expect(pageErrors).toEqual([]);

  await retryPause.click();
  await secondPause;
  await expect(menu.getByRole("alert")).toHaveCount(0);
  releasePauseSuccess();
  await expect(menu).toHaveCount(0);

  await trigger.click();
  menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name: "Restart session" }).click();
  await menu.getByRole("menuitem", { name: "Confirm restart session" }).click();
  await firstClear;
  await expect(menu).toHaveAttribute("aria-busy", "true");
  await expect(menu.getByRole("menuitem", { name: "Restarting session" })).toHaveAttribute("aria-disabled", "true");
  releaseClearFailure();

  const clearAlert = menu.getByRole("alert");
  await expect(clearAlert).toHaveText("Context is still in use");
  const retryClear = menu.getByRole("menuitem", { name: "Confirm restart session" });
  await expect(retryClear).toBeFocused();
  await expect(retryClear).toHaveAttribute("aria-describedby", /agent-action-error/);
  expect(pageErrors).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  menu = page.getByRole("menu");
  await expect(menu.getByRole("alert")).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Restart session" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Confirm restart session" })).toHaveCount(0);
  expect(actions).toEqual(["pause", "pause", "clear-context"]);
  expect(deleteRequests).toBe(0);
});

test("agent menu dismisses with Escape and outside click", async ({ page }) => {
  await page.goto("/");
  const more = page.getByRole("button", { name: "More options for lead" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menu")).toBeVisible();
  const configure = page.getByRole("menuitem", { name: "Configure agent" });
  const pause = page.getByRole("menuitem", { name: "Pause agent" });
  await expect(configure).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pause).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(configure).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Open conversation with lead" })).toBeFocused();
  await more.click();
  await page.getByRole("heading", { name: "Agents", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("leader agent menu traverses only available actions", async ({ page }) => {
  await page.goto("/");
  const more = page.getByRole("button", { name: "More options for lead" });
  await more.focus();
  await more.press("Enter");

  const menu = page.getByRole("menu");
  const configure = menu.getByRole("menuitem", { name: "Configure agent" });
  const pause = menu.getByRole("menuitem", { name: "Pause agent" });
  const clear = menu.getByRole("menuitem", { name: "Restart session" });
  await expect(configure).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pause).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(clear).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(configure).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("task action menu supports keyboard navigation", async ({ page }) => {
  await page.goto("/");
  const task = page.getByRole("button", { name: /Prepare and ship the launch.*Running/ });
  const trigger = page.getByRole("button", { name: "Actions for task Prepare and ship the launch." });
  const nextChild = page.getByRole("button", { name: /Build the launch page.*Queued/ }).first();

  await trigger.focus();
  await page.keyboard.press("Enter");
  const cancel = page.getByRole("menuitem", { name: "Cancel task" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("menuitem", { name: "Confirm cancellation" });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Space");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(nextChild).toBeFocused();

  await trigger.focus();
  await page.keyboard.press("Space");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(task).toBeFocused();
});

test("task deletion failure stays retryable and guarded", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/projects/*/work-items", async (route, request) => {
    if (request.method() !== "DELETE") {
      await route.continue();
      return;
    }
    requests += 1;
    await route.fulfill(requests === 1
      ? { status: 500, contentType: "application/json", body: '{"error":"Delete temporarily unavailable"}' }
      : { status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");
  await page.getByText(/^History \(\d+\)$/).click();
  const trigger = page.getByRole("button", { name: "Actions for task Research the launch audience." });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  const confirm = page.getByRole("menuitem", { name: "Delete permanently" });
  await confirm.evaluate((button) => {
    button.click();
    button.click();
  });

  await expect.poll(() => requests).toBe(1);
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("alert")).toHaveText("Delete temporarily unavailable");
  await expect(menu).toBeVisible();
  await expect(confirm).toBeEnabled();

  await confirm.click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page.getByRole("menuitem", { name: "Delete permanently" }).click();
  await expect.poll(() => requests).toBe(3);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("draft workbench stays separate and reachable across dashboard breakpoints", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const fs = await import("node:fs");
  const drafts = path.join(process.cwd(), ".e2e", "workspace", ".cairn-harness", "drafts");
  const orderingDrafts = Array.from({ length: 8 }, (_, index) => path.join(drafts, `autofocus-${testInfo.project.name}-${index}.md`));
  orderingDrafts.forEach((file, index) => fs.writeFileSync(file, `Earlier draft ${index + 1}.`));
  const scenarios = [
    { width: 320, height: 844, reducedMotion: false },
    { width: 390, height: 844, reducedMotion: false },
    { width: 390, height: 844, reducedMotion: true },
    { width: 720, height: 844, reducedMotion: false },
    { width: 721, height: 844, reducedMotion: false },
    { width: 800, height: 900, reducedMotion: false },
    { width: 801, height: 844, reducedMotion: false },
    { width: 1024, height: 900, reducedMotion: false },
    { width: 1050, height: 900, reducedMotion: false },
    { width: 1051, height: 900, reducedMotion: false },
    { width: 1440, height: 900, reducedMotion: false },
    { width: 1920, height: 1080, reducedMotion: false },
  ];
  try {
    for (const scenario of scenarios) {
      await page.setViewportSize(scenario);
      await page.emulateMedia({ reducedMotion: scenario.reducedMotion ? "reduce" : "no-preference" });
      await page.goto("/");
      await page.evaluate(() => {
        const measured = window as typeof window & { __scrollPositions: number[] };
        measured.__scrollPositions = [];
        addEventListener("scroll", () => measured.__scrollPositions.push(scrollY), { once: false });
      });
      await page.getByRole("button", { name: "New task" }).click();
      const editor = page.getByRole("textbox", { name: "Draft document" });
      await expect(editor).toBeFocused();
      await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
      if (scenario.width > 1050) {
        await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Active work", exact: true })).toBeVisible();
        await expect(page.getByRole("complementary", { name: "Recent activity" })).toBeVisible();
      } else {
        const workspace = page.getByRole("navigation", { name: "Project workspace" });
        await expect(workspace).toBeVisible();
        await workspace.getByRole("button", { name: "Overview" }).click();
        await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
        await expect(editor).toBeVisible();
        await workspace.getByRole("button", { name: "Recent activity" }).click();
        await expect(page.getByRole("complementary", { name: "Recent activity" })).toBeVisible();
        await workspace.getByRole("button", { name: "Overview" }).click();
      }
      await page.evaluate(() => {
        const measured = window as typeof window & { __scrollPositions: number[] };
        measured.__scrollPositions = [];
      });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const geometry = await editor.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const workspace = node.closest<HTMLElement>("[aria-label='Draft editor']");
        const workbench = node.closest<HTMLElement>("[data-draft-workbench]");
        const toolbar = workspace?.querySelector<HTMLElement>("[class*='toolbar']");
        const workspaceRect = workspace?.getBoundingClientRect();
        const workbenchRect = workbench?.getBoundingClientRect();
        const controls = [...(workspace?.querySelectorAll<HTMLElement>("button") || [])];
        const measured = window as typeof window & { __scrollPositions: number[] };
        return {
          top: rect.top,
          bottom: rect.bottom,
          innerWidth,
          position: workspace ? getComputedStyle(workspace).position : "",
          workbenchPosition: workbench ? getComputedStyle(workbench).position : "",
          toolbarPosition: toolbar ? getComputedStyle(toolbar).position : "",
          toolbarTop: toolbar ? Number.parseFloat(getComputedStyle(toolbar).top) : 0,
          separate: !node.closest("main"),
          contained: Boolean(workspaceRect && workbenchRect && workspaceRect.left >= workbenchRect.left && workspaceRect.right <= workbenchRect.right),
          workbenchWidth: workbenchRect?.width || 0,
          workbenchBottom: workbenchRect ? Math.abs(innerHeight - workbenchRect.bottom) : Infinity,
          workbenchHeight: workbenchRect?.height || 0,
          minControlHeight: Math.min(...controls.map((control) => control.getBoundingClientRect().height)),
          visibleHeight: Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)),
          overflow: document.documentElement.scrollWidth - innerWidth,
          scrollPositions: [...new Set(measured.__scrollPositions)],
        };
      });
      expect(geometry.overflow, `${scenario.width}px horizontal overflow: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(0);
      expect(geometry.position).toBe("static");
      expect(geometry.workbenchPosition).toBe(scenario.width <= 1050 ? "fixed" : "static");
      expect(geometry.toolbarPosition).toBe("sticky");
      expect(geometry.toolbarTop).toBe(0);
      expect(geometry.separate).toBe(true);
      expect(geometry.contained).toBe(true);
      expect(geometry.workbenchWidth).toBeLessThanOrEqual(scenario.width);
      expect(geometry.workbenchBottom).toBeLessThanOrEqual(2);
      expect(geometry.workbenchHeight).toBeLessThanOrEqual(scenario.height * .75 + 1);
      expect(geometry.minControlHeight).toBeGreaterThanOrEqual(scenario.width <= 720 ? 44 : 30);
      expect(geometry.scrollPositions.length).toBeLessThanOrEqual(1);
      expect(geometry.visibleHeight, `${scenario.width}px editor visibility: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(120);

      if (scenario.width === 1440) {
        await editor.fill(Array.from({ length: 80 }, (_, index) => `Reachable line ${index + 1}`).join("\n"));
        await expect(editor).toContainText("Reachable line 80");
        const panel = page.getByRole("tabpanel");
        const scroller = panel.locator("[aria-label='Draft editor'] > :first-child");
        expect(await scroller.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
        await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
        const lastLine = editor.locator(":scope > *").last();
        await expect(lastLine).toBeInViewport();
      }
    }
  } finally {
    orderingDrafts.forEach((file) => fs.rmSync(file, { force: true }));
  }
});

test("reduced motion disables active progress animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const project = page.getByRole("button", { name: /Persona test.*tasks/ });
  const task = page.getByRole("button", { name: /Prepare and ship the launch.*Running/ });
  expect(await project.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await task.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
});

test("settings owns project colors but not agent identity", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("lead color")).toHaveCount(0);
  const color = page.getByLabel("Persona test project color");
  await color.fill("#ff5500");
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  const project = page.getByRole("button", { name: /Persona test.*tasks/ });
  await expect.poll(() => project.evaluate((node) => getComputedStyle(node).getPropertyValue("--project-color"))).toBe("#ff5500");
});

test("project actions are available without right click", async ({ page }) => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const projectId = "long-project-actions";
  const projectName = "A very long project name that must remain constrained beside its large active task count";
  const projectDirectory = path.join(process.cwd(), ".e2e", "projects", projectId);
  const workspace = path.join(process.cwd(), ".e2e", "long-project-actions-workspace");
  rmSync(projectDirectory, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(path.join(workspace, ".cairn-harness"), { recursive: true });
  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(path.join(projectDirectory, "project.json"), JSON.stringify({
    name: projectName,
    root: workspace,
    leader: "lead",
    roles: [{ name: "lead", description: "Project lead", prompt: "Lead the project." }],
  }));
  const db = new DatabaseSync(path.join(workspace, ".cairn-harness", "harness.db"));
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE context_resets(agent_id TEXT PRIMARY KEY,cleared_at TEXT NOT NULL);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('lead','Project lead','lead-session','idle',NULL,'2026-07-13T12:00:00Z');
    WITH RECURSIVE numbers(value) AS (
      SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 123
    )
    INSERT INTO tasks
    SELECT printf('task-%d',value),NULL,NULL,'root','manual','dashboard','lead','work-item','Long task',NULL,'pending',0,NULL,'2026-07-13T12:00:00Z',NULL,NULL
    FROM numbers;
  `);
  db.close();

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Persona test" })).toBeVisible();
    const trigger = page.getByRole("button", { name: `More options for ${projectName}` });
    const project = page.locator(`[data-project-selection="${projectId}"]`);
    await expect(trigger).toBeVisible();
    await expect(project.getByLabel("123 tasks")).toHaveText("123");
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(page.getByRole("heading", { name: "Persona test" })).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    let menu = page.getByRole("menu", { name: `${projectName} project actions` });
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    menu = page.getByRole("menu", { name: `${projectName} project actions` });
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();
    const anchored = await Promise.all([
      trigger.boundingBox(),
      menu.boundingBox(),
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    ]);
    const [triggerBox, menuBox, viewport] = anchored;
    expect(triggerBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeCloseTo(Math.max(8, Math.min(triggerBox!.x + triggerBox!.width - menuBox!.width, viewport.width - menuBox!.width - 8)), 0);
    expect(menuBox!.y).toBeCloseTo(Math.max(8, Math.min(triggerBox!.y + triggerBox!.height + 4, viewport.height - menuBox!.height - 8)), 0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    menu = page.getByRole("menu", { name: `${projectName} project actions` });
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    await trigger.press("Space");
    menu = page.getByRole("menu", { name: `${projectName} project actions` });
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();
    await page.getByRole("heading", { name: "Persona test" }).click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).not.toBeFocused();

    await trigger.click();
    menu = page.getByRole("menu", { name: `${projectName} project actions` });
    await menu.getByRole("menuitem", { name: "Pause agents" }).click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(project.getByLabel("Project paused")).toBeVisible();

    await project.click({ button: "right" });
    menu = page.getByRole("menu", { name: `${projectName} project actions` });
    await expect(menu.getByRole("menuitem", { name: "Appearance" })).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");

    const bounds = await Promise.all([
      project.boundingBox(),
      trigger.boundingBox(),
      page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth })),
    ]);
    expect(bounds[0]!.x + bounds[0]!.width).toBeLessThanOrEqual(bounds[2].width);
    expect(bounds[1]!.x + bounds[1]!.width).toBeLessThanOrEqual(bounds[2].width);
    expect(bounds[2].scrollWidth).toBeLessThanOrEqual(bounds[2].width);
  } finally {
    rmSync(projectDirectory, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("project actions support keyboard navigation and destructive confirmation", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "More options for Persona test" });
  await trigger.focus();
  await trigger.press("Enter");

  let menu = page.getByRole("menu", { name: "Persona test project actions" });
  const appearance = menu.getByRole("menuitem", { name: "Appearance" });
  const workflow = menu.getByRole("menuitem", { name: "Project workflow" });
  const pause = menu.getByRole("menuitem", { name: "Pause agents" });
  const removeOption = menu.getByRole("menuitem", { name: "Remove project…" });
  await expect(appearance).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(workflow).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(pause).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(removeOption).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(appearance).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(removeOption).toBeFocused();
  await page.keyboard.press("Home");
  await expect(appearance).toBeFocused();
  await page.keyboard.press("End");
  await expect(removeOption).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(trigger).not.toBeFocused();

  await trigger.focus();
  await trigger.press("Enter");
  menu = page.getByRole("menu", { name: "Persona test project actions" });
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  menu = page.getByRole("menu", { name: "Persona test project actions" });
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Remove project…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Remove Persona test?" });
  await expect(dialog.getByText(/permanently delete this project's task history, agent sessions, Cairn memory, and project-specific skills/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Remove project" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("project action surfaces restore focus without leaving focus behind the overlay", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "More options for Persona test" });

  await trigger.click();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  const appearance = page.getByRole("dialog", { name: "Appearance · Persona test" });
  await expect(appearance).toBeVisible();
  await expect(trigger).not.toBeFocused();
  await appearance.getByRole("button", { name: "Close" }).click();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("menuitem", { name: "Project workflow" }).click();
  const workflow = page.getByRole("dialog", { name: "Project workflow" });
  await expect(workflow).toBeVisible();
  await expect(trigger).not.toBeFocused();
  await workflow.getByRole("button", { name: "Close" }).click();
  await expect(trigger).toBeFocused();
});

test("project menu and removal dialog fit a narrow viewport", async ({ page }) => {
  for (const viewport of [{ width: 240, height: 640 }, { width: 320, height: 240 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "More options for Persona test" });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Persona test project actions" });
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(8);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(menuBox!.y).toBeGreaterThanOrEqual(8);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height - 8);

    await menu.getByRole("menuitem", { name: "Remove project…" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Remove Persona test?" });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    const remove = dialog.getByRole("button", { name: "Remove project" });
    await remove.scrollIntoViewIfNeeded();
    await expect(remove).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("project actions stay anchored and focused through live refreshes", async ({ page }) => {
  const projectsResponse = await page.request.get("/api/projects");
  const projects = await projectsResponse.json() as Array<Record<string, unknown>>;
  let projectRequests = 0;
  await page.addInitScript(() => {
    const sources: Array<{ onmessage: ((event: MessageEvent<string>) => void) | null }> = [];
    class MockEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor() {
        sources.push(this);
        queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: "ready" })));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
    (window as typeof window & { refreshProject: () => void }).refreshProject = () => {
      const message = new MessageEvent("message", {
        data: JSON.stringify({ projectId: ".e2e", conversations: [] }),
      });
      for (const source of sources) source.onmessage?.(message);
    };
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    projectRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "More options for Persona test" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Persona test project actions" });
  const workflow = menu.getByRole("menuitem", { name: "Project workflow" });
  await workflow.focus();
  const before = await Promise.all([trigger.boundingBox(), menu.boundingBox()]);
  const requestsBeforeRefresh = projectRequests;

  await page.evaluate(() => (window as typeof window & { refreshProject: () => void }).refreshProject());
  await expect.poll(() => projectRequests).toBeGreaterThan(requestsBeforeRefresh);
  await expect(workflow).toBeFocused();
  const after = await Promise.all([trigger.boundingBox(), menu.boundingBox()]);

  for (const index of [0, 1]) {
    expect(after[index]?.x).toBeCloseTo(before[index]?.x || 0, 0);
    expect(after[index]?.y).toBeCloseTo(before[index]?.y || 0, 0);
  }
});

test("project action overlays close when a live refresh removes their project", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const projectsResponse = await page.request.get("/api/projects");
  const projects = await projectsResponse.json() as Array<Record<string, unknown>>;
  const replacement = { ...projects[0], id: "replacement", name: "Replacement project" };
  let projectVisible = true;
  await page.addInitScript(() => {
    const sources: Array<{ onmessage: ((event: MessageEvent<string>) => void) | null }> = [];
    class MockEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor() {
        sources.push(this);
        queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: "ready" })));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
    (window as typeof window & { refreshProject: () => void }).refreshProject = () => {
      const message = new MessageEvent("message", {
        data: JSON.stringify({ projectId: ".e2e", conversations: [] }),
      });
      for (const source of sources) source.onmessage?.(message);
    };
  });
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projectVisible ? projects : [replacement]),
    });
  });

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "More options for Persona test" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Remove project…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Remove Persona test?" });
  await expect(dialog).toBeVisible();

  projectVisible = false;
  await page.evaluate(() => (window as typeof window & { refreshProject: () => void }).refreshProject());
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Persona test project actions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More options for Replacement project" })).toBeFocused();
});

test("paused projects keep their queued task count", async ({ page }) => {
  await page.goto("/");
  const project = page.getByRole("button", { name: /Persona test.*tasks/ });
  const taskCount = project.getByLabel("1 tasks");

  try {
    await expect(taskCount).toHaveText("1");
    expect(await project.evaluate((node) => getComputedStyle(node).animationName)).not.toBe("none");

    await project.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pause agents" }).click();
    await expect(project.getByLabel("Project paused")).toBeVisible();
    await expect(taskCount).toHaveText("1");
    expect(await project.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");

    await project.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Resume agents" }).click();
    await expect(project.getByLabel("Project paused")).toHaveCount(0);
    await expect(taskCount).toHaveText("1");
    expect(await project.evaluate((node) => getComputedStyle(node).animationName)).not.toBe("none");
  } finally {
    await page.request.patch("/api/projects/.e2e", { data: { paused: false } });
  }
});

test("project settings pause, resume, and safely confirm removal", async ({ page }) => {
  const fs = await import("node:fs");
  const fixture = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const worker = path.join(process.cwd(), fixture, "workspace", ".cairn-harness", "ui-worker.json");
  const paused = path.join(process.cwd(), fixture, ".cairn-paused");
  await page.goto("/");
  const currentProject = page.getByRole("button", { name: /Persona test.*tasks/ });
  await currentProject.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pause agents" }).click();
  await expect.poll(() => fs.existsSync(paused)).toBe(true);
  await expect.poll(() => fs.existsSync(worker)).toBe(false);
  await currentProject.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Resume agents" }).click();
  await expect.poll(() => fs.existsSync(paused)).toBe(false);
  await expect.poll(() => fs.existsSync(worker)).toBe(true);

  const disposableWorkspace = path.join(process.cwd(), fixture, "disposable-workspace");
  fs.mkdirSync(disposableWorkspace, { recursive: true });
  fs.mkdirSync(path.join(disposableWorkspace, ".cairn-harness", "cairn"), { recursive: true });
  fs.mkdirSync(path.join(disposableWorkspace, ".cairn-harness", "copilot-home", "lead", "skills", "project-skill"), { recursive: true });
  fs.writeFileSync(path.join(disposableWorkspace, "source.txt"), "preserve");
  fs.writeFileSync(path.join(disposableWorkspace, ".cairn-harness", "worker.log"), "history");
  fs.writeFileSync(path.join(disposableWorkspace, ".cairn-harness", "cairn", "cairn.db"), "brain");
  fs.writeFileSync(path.join(disposableWorkspace, ".cairn-harness", "copilot-home", "lead", "skills", "project-skill", "SKILL.md"), "skill");
  const created = await page.request.post("/api/projects", { data: { name: "Disposable project", workspace: disposableWorkspace } });
  expect(created.ok()).toBe(true);
  await page.reload();
  const project = page.getByRole("button", { name: /Disposable project.*tasks/ });
  await project.click();
  await expect(page.getByRole("heading", { name: "Disposable project" })).toBeVisible();
  await project.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove project…" }).click();
  const remove = page.getByRole("button", { name: "Remove project" });
  await expect(page.getByRole("alertdialog", { name: "Remove Disposable project?" }).getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(page.getByRole("alertdialog", { name: "Remove Disposable project?" }).getByRole("textbox")).toHaveCount(0);
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(page.getByText("Disposable project", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Persona test" })).toBeVisible();
  expect(fs.existsSync(path.join(process.cwd(), fixture, "projects", "disposable-project"))).toBe(false);
  expect(fs.existsSync(path.join(disposableWorkspace, ".cairn-harness"))).toBe(false);
  expect(fs.existsSync(path.join(disposableWorkspace, "source.txt"))).toBe(true);
  fs.rmSync(disposableWorkspace, { recursive: true, force: true });
});

test("project deletion removes Harness history and preserves repository files", async ({ page }) => {
  const fs = await import("node:fs");
  const fixture = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const workspace = path.join(process.cwd(), fixture, "state-cleanup-workspace");
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "source.txt"), "preserve");
  const created = await page.request.post("/api/projects", {
    data: { name: "State cleanup project", workspace },
  });
  expect(created.ok()).toBe(true);
  fs.mkdirSync(path.join(workspace, ".cairn-harness", "cairn"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".cairn-harness", "copilot-home", "lead", "session-state", "session"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".cairn-harness", "copilot-home", "lead", "skills", "project-skill"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".cairn-harness", "worker.log"), "history");
  fs.writeFileSync(path.join(workspace, ".cairn-harness", "cairn", "cairn.db"), "brain");
  fs.writeFileSync(path.join(workspace, ".cairn-harness", "copilot-home", "lead", "session-state", "session", "events.jsonl"), "session");
  fs.writeFileSync(path.join(workspace, ".cairn-harness", "copilot-home", "lead", "skills", "project-skill", "SKILL.md"), "skill");

  const removed = await page.request.delete("/api/projects/state-cleanup-project", {
    data: { confirmation: "state-cleanup-project" },
  });

  expect(removed.ok(), await removed.text()).toBe(true);
  expect(fs.existsSync(path.join(workspace, ".cairn-harness"))).toBe(false);
  expect(fs.existsSync(path.join(workspace, "source.txt"))).toBe(true);
  expect(fs.existsSync(path.join(process.cwd(), fixture, "projects", "state-cleanup-project"))).toBe(false);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("failed project controls remain visible and retryable", async ({ page }) => {
  let releasePatchFailure!: () => void;
  const patchFailureReleased = new Promise<void>((resolve) => { releasePatchFailure = resolve; });
  let patchFailureStarted!: () => void;
  const firstPatch = new Promise<void>((resolve) => { patchFailureStarted = resolve; });
  let releasePatchSuccess!: () => void;
  const patchSuccessReleased = new Promise<void>((resolve) => { releasePatchSuccess = resolve; });
  let patchSuccessStarted!: () => void;
  const secondPatch = new Promise<void>((resolve) => { patchSuccessStarted = resolve; });
  let releaseDeleteFailure!: () => void;
  const deleteFailureReleased = new Promise<void>((resolve) => { releaseDeleteFailure = resolve; });
  let deleteFailureStarted!: () => void;
  const firstDelete = new Promise<void>((resolve) => { deleteFailureStarted = resolve; });
  let releaseDeleteSuccess!: () => void;
  const deleteSuccessReleased = new Promise<void>((resolve) => { releaseDeleteSuccess = resolve; });
  let deleteSuccessStarted!: () => void;
  const secondDelete = new Promise<void>((resolve) => { deleteSuccessStarted = resolve; });
  let patchRequests = 0;
  let deleteRequests = 0;
  let deleted = false;

  await page.route("**/api/projects", async (route, request) => {
    if (request.method() === "GET" && deleted) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    await route.continue();
  });
  await page.route("**/api/projects/.e2e", async (route, request) => {
    if (request.method() === "PATCH") {
      patchRequests += 1;
      if (patchRequests === 1) {
        patchFailureStarted();
        await patchFailureReleased;
        return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Pause control unavailable"}' });
      }
      patchSuccessStarted();
      await patchSuccessReleased;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (request.method() === "DELETE") {
      deleteRequests += 1;
      if (deleteRequests === 1) {
        deleteFailureStarted();
        await deleteFailureReleased;
        return route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Project is still releasing"}' });
      }
      deleteSuccessStarted();
      await deleteSuccessReleased;
      deleted = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    await route.continue();
  });

  await page.goto("/");
  const project = page.getByRole("button", { name: /Persona test.*tasks/ });
  await project.click({ button: "right" });
  let menu = page.getByRole("menu", { name: "Persona test project actions" });
  const appearance = menu.getByRole("menuitem", { name: "Appearance" });
  const pause = menu.getByRole("menuitem", { name: "Pause agents" });
  const deleteOption = menu.getByRole("menuitem", { name: "Remove project…" });
  await pause.click();
  await firstPatch;
  const pausing = menu.getByRole("menuitem", { name: "Pausing agents" });
  await expect(menu).toHaveAttribute("aria-busy", "true");
  await expect(appearance).toBeDisabled();
  await expect(pausing).toBeDisabled();
  await expect(deleteOption).toBeDisabled();
  await pausing.evaluate((button) => button.click());
  await page.keyboard.press("Enter");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(patchRequests).toBe(1);

  releasePatchFailure();
  await expect(menu.getByRole("alert")).toHaveText("Pause control unavailable");
  const retryPause = menu.getByRole("menuitem", { name: "Pause agents" });
  await expect(retryPause).toBeEnabled();
  await expect(retryPause).toBeFocused();
  await expect(retryPause).toHaveAttribute("aria-describedby", "project-pause-error");
  await deleteOption.click();
  await expect(menu.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("alertdialog", { name: "Remove Persona test?" }).getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await project.click({ button: "right" });
  menu = page.getByRole("menu", { name: "Persona test project actions" });
  await menu.getByRole("menuitem", { name: "Pause agents" }).click();
  await secondPatch;
  await expect(menu.getByRole("alert")).toHaveCount(0);
  await expect(menu).toHaveAttribute("aria-busy", "true");
  releasePatchSuccess();
  await expect(menu).toHaveCount(0);

  await project.click({ button: "right" });
  menu = page.getByRole("menu", { name: "Persona test project actions" });
  await menu.getByRole("menuitem", { name: "Remove project…" }).click();
  let remove = page.getByRole("button", { name: "Remove project" });
  await remove.click();
  await firstDelete;
  let dialog = page.getByRole("alertdialog", { name: "Remove Persona test?" });
  const deleting = page.getByRole("button", { name: "Removing project" });
  await expect(menu).toHaveCount(0);
  await expect(dialog.locator("form")).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(deleting).toBeDisabled();
  await deleting.evaluate((button) => button.click());
  await page.keyboard.press("Enter");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(deleteRequests).toBe(1);

  releaseDeleteFailure();
  await expect(dialog.getByRole("alert")).toHaveText("Project is still releasing");
  remove = page.getByRole("button", { name: "Remove project" });
  await expect(remove).toBeEnabled();
  await expect(remove).toBeFocused();
  await expect(remove).toHaveAttribute("aria-describedby", "project-delete-error");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await project.click({ button: "right" });
  menu = page.getByRole("menu", { name: "Persona test project actions" });
  await menu.getByRole("menuitem", { name: "Remove project…" }).click();
  dialog = page.getByRole("alertdialog", { name: "Remove Persona test?" });
  remove = page.getByRole("button", { name: "Remove project" });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await remove.click();
  await secondDelete;
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Removing project" })).toBeDisabled();
  releaseDeleteSuccess();
  await expect(project).toHaveCount(0);
});

test("deleted agent activity remains visible without a dead action", async ({ page }) => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const projectDirectory = path.join(process.cwd(), ".e2e", "projects", "deleted-agent-activity");
  const workspace = path.join(process.cwd(), ".e2e", "deleted-agent-workspace");
  rmSync(projectDirectory, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(path.join(workspace, ".cairn-harness"), { recursive: true });
  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(path.join(projectDirectory, ".cairn-paused"), "");
  writeFileSync(path.join(projectDirectory, "project.json"), JSON.stringify({
    name: "Deleted agent activity",
    root: workspace,
    leader: "lead",
    roles: [
      { name: "lead", description: "Project lead", prompt: "Lead the project." },
      { name: "builder", description: "Builder", prompt: "Build the project." },
    ],
  }));
  const db = new DatabaseSync(path.join(workspace, ".cairn-harness", "harness.db"));
  db.exec(`
    CREATE TABLE agents(agent_id TEXT PRIMARY KEY,role TEXT,session_id TEXT,status TEXT,current_topic TEXT,updated_at TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,parent_id TEXT,origin_id TEXT,kind TEXT,source TEXT,creator TEXT,assignee TEXT,topic TEXT,body TEXT,result TEXT,status TEXT,attempts INTEGER,error TEXT,created_at TEXT,claimed_at TEXT,completed_at TEXT);
    CREATE TABLE turns(sequence INTEGER PRIMARY KEY,agent_id TEXT,status TEXT,output_json TEXT,completed_at TEXT);
    CREATE TABLE context_resets(agent_id TEXT PRIMARY KEY,cleared_at TEXT NOT NULL);
    CREATE TABLE releases(content_hash TEXT PRIMARY KEY);
    INSERT INTO agents VALUES('lead','Project lead','lead-session','idle',NULL,'2026-07-13T12:00:00Z');
    INSERT INTO agents VALUES('builder','Builder','builder-session','idle',NULL,'2026-07-13T12:00:00Z');
    INSERT INTO turns VALUES(1,'lead','completed','{"summary":"Current agent activity.","deliverable":null}','2026-07-13T12:03:00Z');
    INSERT INTO turns VALUES(2,'builder','failed','{"summary":"Historical builder activity.","deliverable":null}','2026-07-13T12:04:00Z');
  `);
  db.close();
  let focusedRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/projects/deleted-agent-activity/messages")
      && url.searchParams.get("focus") === "turn:1") focusedRequests += 1;
  });
  let agentRemoved = false;
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const response = await route.fetch();
    const projects = await response.json();
    if (agentRemoved) {
      const project = projects.find((candidate: { id: string }) => candidate.id === "deleted-agent-activity");
      if (project) project.agents = project.agents.filter((agent: { id: string }) => agent.id !== "builder");
    }
    await route.fulfill({ response, json: projects });
  });

  try {
    await page.goto("/");
    const project = page.getByRole("button", { name: /Deleted agent activity.*tasks/ });
    await project.click();
    const rail = page.getByRole("complementary", { name: "Recent activity" });
    const historical = rail.getByRole("button", { name: /Failed: Historical builder activity.*builder/i });
    const timestamp = await historical.locator("time").textContent();

    agentRemoved = true;
    await page.reload();
    await page.getByRole("button", { name: /Deleted agent activity.*tasks/ }).click();

    const summary = rail.getByText("Failed: Historical builder activity", { exact: true });
    const removedRow = summary.locator("..").locator("..").locator("..");
    await expect(removedRow.getByText("Former builder", { exact: true })).toBeVisible();
    await expect(removedRow.locator("time")).toHaveText(timestamp || "");
    await expect(rail.getByRole("button", { name: /Historical builder activity/ })).toHaveCount(0);
    expect(await removedRow.evaluate((node) => node.tagName)).toBe("DIV");
    expect(await removedRow.evaluate((node) => (node as HTMLElement).tabIndex)).toBe(-1);
    expect(await removedRow.evaluate((node) => getComputedStyle(node).cursor)).not.toBe("pointer");
    const summaryColor = await summary.evaluate((node) => getComputedStyle(node).color);
    await removedRow.hover();
    await expect(summary).toHaveCSS("color", summaryColor);

    await rail.getByRole("button", { name: /Current agent activity.*lead/i }).click();
    await expect(page.getByRole("dialog", { name: /^Conversation with / })).toBeVisible();
    expect(focusedRequests).toBe(1);
  } finally {
    rmSync(projectDirectory, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
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
  await expect(user).not.toContainText("You");
  expect(await user.evaluate((node) => getComputedStyle(node.parentElement!).justifyContent)).toBe("flex-end");
});

test("opening a conversation lands on the latest message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const history = page.getByLabel("Conversation history with lead");
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
  const last = history.locator("[data-chat-id]").last();
  await expect(last).toBeVisible({ timeout: 12_000 });
  expect(await history.evaluate((node) => {
    const lastMessage = [...node.querySelectorAll<HTMLElement>("[data-chat-id]")].at(-1);
    const row = lastMessage?.closest<HTMLElement>("[data-index]");
    return row ? Math.abs(row.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom) : Infinity;
  })).toBeLessThanOrEqual(2);
  expect(await history.evaluate((node) => getComputedStyle(node).scrollbarColor)).not.toBe("auto");
  const drawer = page.getByRole("dialog", { name: /^Conversation with / });
  const width = await drawer.evaluate((node) => node.getBoundingClientRect().width);
  if ((page.viewportSize()?.width || 0) > 720) expect(width).toBeGreaterThanOrEqual(600);
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const reopened = page.getByLabel("Conversation history with lead");
  await expect.poll(() => reopened.evaluate((node) =>
    node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
});

test("prefetched conversation never renders a blank first frame", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile") await page.emulateMedia({ reducedMotion: "reduce" });
  let loaded = false;
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const items = Array.from({ length: 30 }, (_, index) => ({
      id: `initial:${index}`,
      sender: "lead",
      recipient: "dashboard",
      body: `Initial message ${index}. ${"Variable height content. ".repeat(index % 5 + 1)}`,
      status: "completed",
      timestamp: new Date(Date.UTC(2026, 6, 15, 8, index)).toISOString(),
      direction: "incoming",
      kind: "assistant",
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, hasMore: false }) });
    loaded = true;
  });

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open conversation with lead" });
  await trigger.hover();
  await expect.poll(() => loaded).toBe(true);
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const state = window as typeof window & {
      prefetchedFrames?: Array<{ visibleSurface: number; visible: number; reveal: boolean; fallback: boolean; mounted: number; duplicateMax: number; logs: number; firstPaint?: unknown }>;
      prefetchedDone?: boolean;
    };
    state.prefetchedFrames = [];
    const sample = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return requestAnimationFrame(sample);
      const log = dialog.querySelector<HTMLElement>('[role="log"]');
      const viewport = log?.getBoundingClientRect();
      const messages = [...dialog.querySelectorAll<HTMLElement>("[data-chat-id]")];
      const isPainted = (node: HTMLElement | null | undefined) => {
        if (!viewport || !node) return false;
        const rect = node.getBoundingClientRect();
        if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return false;
        for (let current: HTMLElement | null = node; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
          if (current === log) break;
        }
        return true;
      };
      const isPaintedSurface = (node: HTMLElement | null | undefined) => {
        if (!isPainted(node) || !node) return false;
        const style = getComputedStyle(node);
        return style.backgroundImage !== "none" || !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor);
      };
      const visible = messages.filter(isPainted).length;
      const reveal = dialog.querySelector<HTMLElement>("[data-chat-reveal]");
      const fallback = dialog.querySelector<HTMLElement>("[data-chat-paint-surface]");
      const revealing = isPaintedSurface(reveal);
      const fallbackPainted = isPaintedSurface(fallback);
      const counts = new Map<string, number>();
      messages.forEach((message) => counts.set(message.dataset.chatId || "", (counts.get(message.dataset.chatId || "") || 0) + 1));
      const firstPaint = visible || !messages[0] ? undefined : {
        viewport: viewport && { top: viewport.top, bottom: viewport.bottom },
        rect: (() => { const rect = messages[0].getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; })(),
        fallback: fallback && { style: fallback.getAttribute("style"), display: getComputedStyle(fallback).display, visibility: getComputedStyle(fallback).visibility, parent: fallback.parentElement?.className },
        layers: [...dialog.querySelectorAll<HTMLElement>("[data-chat-row-layer]")].map((layer) => ({ value: layer.dataset.chatRowLayer, testId: layer.dataset.testid, style: layer.getAttribute("style") })),
        chain: (() => {
          const chain = [];
          for (let current: HTMLElement | null = messages[0]; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            chain.push({ tag: current.tagName, className: current.className, inlineStyle: current.getAttribute("style"), dataIndex: current.getAttribute("data-index"), rowLayer: current.getAttribute("data-chat-row-layer"), testId: current.getAttribute("data-testid"), display: style.display, visibility: style.visibility, opacity: style.opacity, contentVisibility: style.contentVisibility, transform: style.transform });
            if (current === log) break;
          }
          return chain;
        })(),
      };
      state.prefetchedFrames!.push({
        visibleSurface: visible + Number(revealing || fallbackPainted),
        visible,
        reveal: revealing,
        fallback: fallbackPainted,
        mounted: messages.length,
        duplicateMax: Math.max(0, ...counts.values()),
        logs: dialog.querySelectorAll('[role="log"]').length,
        firstPaint,
      });
      if (state.prefetchedFrames!.length === 60) state.prefetchedDone = true;
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await dialog.waitFor({ state: "attached" });
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as typeof window & { prefetchedDone?: boolean }).prefetchedDone))).toBe(true);
  const frames = await page.evaluate(() => {
    return (window as typeof window & {
      prefetchedFrames?: Array<{ visibleSurface: number; visible: number; reveal: boolean; fallback: boolean; mounted: number; duplicateMax: number; logs: number; firstPaint?: unknown }>;
    }).prefetchedFrames || [];
  });
  writeFileSync(testInfo.outputPath("prefetched-frames.json"), JSON.stringify(frames, null, 2));
  await page.screenshot({ path: testInfo.outputPath("final.png") });
  expect(frames.every((frame) => frame.visibleSurface > 0)).toBe(true);
  expect(Math.max(...frames.map((frame) => frame.duplicateMax))).toBe(1);
  expect(frames.every((frame) => frame.logs === 1)).toBe(true);
  expect(frames.some((frame) => frame.visible > 0 && (frame.reveal || frame.fallback))).toBe(true);
  expect(frames.at(-1)).toMatchObject({ reveal: false, fallback: false });
  expect(frames.at(-1)?.visible).toBeGreaterThan(0);
  await expect(dialog.getByRole("log", { name: "Conversation history with lead" })).toHaveCount(1);
});

test("empty prefetch can revalidate into tool-heavy history", async ({ page }) => {
  let requests = 0;
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    requests++;
    const items = requests === 1 ? [] : [
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `tool:${index}`,
        sender: "lead",
        recipient: "powershell",
        body: `Tool result ${index}`,
        status: "completed",
        timestamp: new Date(Date.UTC(2026, 6, 15, 8, index)).toISOString(),
        direction: "outgoing",
        kind: "tool",
      })),
      {
        id: "assistant:complete",
        sender: "lead",
        recipient: "dashboard",
        body: "Recovered conversation history.",
        status: "completed",
        timestamp: new Date(Date.UTC(2026, 6, 15, 9)).toISOString(),
        direction: "outgoing",
        kind: "assistant",
      },
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, hasMore: false }) });
  });

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open conversation with lead" });
  await trigger.hover();
  await expect.poll(() => requests).toBe(1);
  await trigger.click();
  await expect(page.getByText("Recovered conversation history.", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("uncached conversation shows loading instead of a blank first frame", async ({ page }) => {
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  await expect(dialog.getByText("Loading conversation", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("log", { name: "Conversation history with lead" })).toBeVisible();
});

test("empty conversation resolves to a clear empty state", async ({ page }) => {
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], hasMore: false }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  const history = dialog.getByRole("log", { name: "Conversation history with lead" });
  await expect(history).toHaveText("No messages yet. Send a message below to begin.");
  await expect(dialog.getByText("Loading conversation", { exact: true })).toHaveCount(0);
});

test("opening a conversation stays at the latest after delayed history layout", async ({ page }) => {
  await page.route("**/api/projects/*/messages?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await new Promise((resolve) => setTimeout(resolve, 150));
    data.items.push({
      id: "live:lead:delayed-entry",
      sender: "lead",
      recipient: "team",
      body: Array.from({ length: 20 }, (_, index) => `Live response line ${index + 1}.`).join(" "),
      status: "streaming",
      timestamp: new Date().toISOString(),
      direction: "outgoing",
      kind: "assistant",
      title: "Live response",
      live: true,
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const history = page.getByLabel("Conversation history with lead");
  await expect(page.getByText("Live response line 20.", { exact: false })).toBeVisible();
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
});

test("sending at the bottom never flashes the Latest control", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  const history = page.getByLabel("Conversation history with lead");
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
  await dialog.evaluate((node) => {
    const state = window as typeof window & { latestControlSeen?: boolean; latestObserver?: MutationObserver };
    const scan = () => {
      if ([...node.querySelectorAll("button")].some((button) => button.textContent?.includes("Latest"))) {
        state.latestControlSeen = true;
      }
    };
    state.latestControlSeen = false;
    state.latestObserver = new MutationObserver(scan);
    state.latestObserver.observe(node, { childList: true, subtree: true, characterData: true });
  });
  const message = Array.from({ length: 30 }, (_, index) => `Immediate message line ${index + 1}.`).join(" ");
  await dialog.getByRole("textbox").fill(message);
  await dialog.getByRole("button", { name: "Send message" }).click();
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => (window as typeof window & { latestControlSeen?: boolean }).latestControlSeen)).toBe(false);
});

test("large histories render a small window and load older pages on scroll", async ({ page }) => {
  const snapshot = await page.request.get("/api/projects");
  expect(await snapshot.text()).not.toContain('"conversations"');
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation with lead" });
  const history = page.getByLabel("Conversation history with lead");
  await expect(history.locator("[data-chat-id]").last()).toBeVisible();
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
  expect(await dialog.locator("article").count()).toBeLessThan(40);
  const projectId = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const latest = await page.request.get(`/api/projects/${projectId}/messages?agent=lead&limit=80`);
  const latestPage = await latest.json() as { nextBefore?: string };
  const older = await page.request.get(`/api/projects/${projectId}/messages?agent=lead&limit=80&before=${encodeURIComponent(latestPage.nextBefore || "")}`);
  const olderPage = await older.json() as { items: { body: string }[] };
  const olderTarget = olderPage.items.at(-1)?.body;
  if (!olderTarget) throw new Error("Expected an older conversation page");
  await expect(dialog.getByText(olderTarget, { exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    await history.evaluate((node) => node.scrollTo({ top: 0 }));
    return page.getByText(olderTarget, { exact: true }).count();
  }, { timeout: 12000, intervals: [300, 500, 700] }).toBe(1);
  expect(await dialog.locator("article").count()).toBeLessThan(50);
});

test("live conversation refresh preserves paged history and its scroll anchor", async ({ page }) => {
  const projectId = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  await page.addInitScript((activeProjectId) => {
    const sources: Array<{ onmessage: ((event: MessageEvent<string>) => void) | null }> = [];
    class MockEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      constructor() {
        sources.push(this);
        queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: "ready" })));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
    (window as typeof window & { refreshLeadConversation: () => void }).refreshLeadConversation = () => {
      const event = new MessageEvent("message", {
        data: JSON.stringify({ projectId: activeProjectId, conversations: ["lead"] }),
      });
      for (const source of sources) source.onmessage?.(event);
    };
  }, projectId);
  const messageRequests: string[] = [];
  let appended = false;
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    messageRequests.push(request.url());
    const url = new URL(request.url());
    const before = url.searchParams.get("before");
    const end = Number(before || (appended ? 121 : 120));
    const start = before ? Math.max(0, end - 30) : 90;
    const items = Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return {
        id: `stable:${index}`,
        sender: "lead",
        recipient: "dashboard",
        body: `Stable message ${String(index).padStart(3, "0")}`,
        status: "completed",
        timestamp: new Date(Date.UTC(2026, 6, 15, 8, index)).toISOString(),
        direction: "incoming",
        kind: "assistant",
      };
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, hasMore: start > 0, nextBefore: start ? String(start) : undefined }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const history = page.getByLabel("Conversation history with lead");
  await expect(page.getByText("Stable message 119", { exact: true })).toBeVisible();
  await history.hover();
  await expect.poll(async () => {
    await page.mouse.wheel(0, -4_000);
    return messageRequests.some((url) => new URL(url).searchParams.has("before"));
  }, { timeout: 12000, intervals: [300, 500, 700] }).toBe(true);
  await expect(page.getByText("Stable message 060", { exact: true })).toBeVisible();
  await history.evaluate((node) => node.scrollBy({ top: 300 }));
  const anchor = await stableConversationViewport(history);
  const composer = page.getByRole("textbox", { name: "Message lead" });
  await expect(composer).toBeFocused();
  messageRequests.length = 0;
  appended = true;
  const refreshed = page.waitForResponse((response) =>
    response.url().includes(`/api/projects/${projectId}/messages?agent=lead`));
  await page.evaluate(() => {
    (window as typeof window & { refreshLeadConversation: () => void }).refreshLeadConversation();
  });
  await refreshed;
  await expect.poll(() => messageRequests.filter((url) => !new URL(url).searchParams.has("before")).length).toBe(1);
  expect(messageRequests.filter((url) => new URL(url).searchParams.has("before"))).toEqual([]);
  await expect.poll(async () => {
    const current = await conversationViewport(history);
    return current.firstVisible === anchor.firstVisible && Math.abs(current.offset - anchor.offset) <= 2;
  }).toBe(true);
  await expect(composer).toBeFocused();
  await expect(page.getByText("Stable message 120", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Jump to latest, 1 new message" })).toBeVisible();
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect(page.getByText("Stable message 120", { exact: true })).toBeVisible();
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
});

test("consecutive prepends preserve the visible message and pixel offset", async ({ page }) => {
  const requests: string[] = [];
  const releases = new Map<string, () => void>();
  await page.route("**/api/projects/*/messages?agent=lead*", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    const before = new URL(request.url()).searchParams.get("before");
    const end = Number(before || 90);
    const start = Math.max(0, end - 30);
    if (before) {
      requests.push(before);
      await new Promise<void>((resolve) => releases.set(before, resolve));
    }
    const items = Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return {
        id: `prepend:${index}`,
        sender: "lead",
        recipient: "dashboard",
        body: `Prepend message ${index}\n\n${"Variable height content. ".repeat(index % 5 + 1)}`,
        status: "completed",
        timestamp: new Date(Date.UTC(2026, 6, 15, 8, index)).toISOString(),
        direction: "incoming",
        kind: "assistant",
      };
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, hasMore: start > 0, nextBefore: start ? String(start) : undefined }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const history = page.getByLabel("Conversation history with lead");
  await expect(page.getByText("Prepend message 89", { exact: false })).toBeVisible();
  for (const cursor of ["60", "30"]) {
    await history.evaluate((node) => node.scrollTo({ top: 0 }));
    await history.hover();
    await page.mouse.wheel(0, -1);
    await expect.poll(() => requests.filter((request) => request === cursor).length).toBe(1);
    const anchor = await stableConversationViewport(history);
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).searchParams.get("before") === cursor);
    releases.get(cursor)?.();
    await response;
    await expect.poll(async () => {
      const offset = await conversationAnchorOffset(history, anchor.firstVisible);
      return offset === undefined ? Infinity : Math.abs(offset - anchor.offset);
    }).toBeLessThanOrEqual(2);
    expect(requests.filter((request) => request === cursor)).toHaveLength(1);
  }
});

test("focused conversation stays bounded on large histories", async ({ page }) => {
  const focusId = "turn:2";
  const limit = 20;
  const projectId = process.env.PLAYWRIGHT_FIXTURE_DIR || ".e2e";
  const sentinelCache = path.join(process.cwd(), projectId, "workspace", ".cairn-harness", "ui-session-cache", "lead", "sentinel.json");
  rmSync(sentinelCache, { force: true });
  const response = await page.request.get(`/api/projects/${projectId}/messages?agent=lead&focus=${focusId}&limit=${limit}`);
  const result = await response.json() as {
    items: { id: string; body: string; timestamp: string }[];
    hasMore: boolean;
    nextBefore?: string;
  };
  const cursors = result.items.map((message) => `${message.timestamp}\u0000${message.id}`);
  expect(result.items.length).toBeLessThanOrEqual(limit);
  expect(result.items.some((message) => message.id === focusId)).toBe(true);
  expect(cursors).toEqual([...cursors].sort());
  expect(new Set(result.items.map((message) => message.id)).size).toBe(result.items.length);
  expect(result.nextBefore).toBe(cursors[0]);
  expect(result.hasMore).toBe(true);
  expect(existsSync(sentinelCache)).toBe(false);

  const pages = new Map<string, { id: string; body: string }[]>();
  page.on("response", async (candidate) => {
    const url = candidate.url();
    if (!url.includes(`/api/projects/${projectId}/messages?`) || !url.includes("agent=lead")) return;
    const body = await candidate.json() as { items: { id: string; body: string }[] };
    pages.set(url, body.items);
  });
  await page.goto("/");
  await page.getByRole("button", { name: /lead Focused bounded turn/ }).click();
  const history = page.getByLabel("Conversation history with lead");
  const focusedMessage = page.locator(`[data-chat-id="${focusId}"]`);
  await expect.poll(() => focusedMessage.evaluate((node) => {
    const historyNode = node.closest<HTMLElement>('[aria-label="Conversation history with lead"]');
    if (!historyNode) return Infinity;
    const message = node.getBoundingClientRect();
    const viewport = historyNode.getBoundingClientRect();
    return Math.abs((message.top + message.bottom) / 2 - (viewport.top + viewport.bottom) / 2);
  })).toBeLessThanOrEqual(2);
  await expect.poll(async () => {
    await history.evaluate((node) => node.scrollTo({ top: 0 }));
    return page.getByText("Archived message 000", { exact: true }).count();
  }, { timeout: 12000, intervals: [300, 500, 700] }).toBe(1);

  const loaded = [...pages.values()].flat();
  expect(new Set(loaded.map((message) => message.id)).size).toBe(loaded.length);
  const archived = loaded
    .map((message) => /^Archived message (\d+)$/.exec(message.body)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .sort((a, b) => a - b);
  expect(archived).toEqual(Array.from({ length: archived.at(-1)! + 1 }, (_, index) => index));
  await page.getByRole("button", { name: "Return to latest" }).click();
  await expect(page.getByRole("button", { name: "Return to latest" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message lead" })).toBeFocused();
  await expect.poll(() => history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
});

test("sending from focused history immediately shows the message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /lead Focused bounded turn/ }).click();
  const dialog = page.getByRole("dialog", { name: /^Conversation with / });
  const message = "Keep completed work under a history accordion.";

  await dialog.getByRole("textbox").fill(message);
  await dialog.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Return to latest" })).toHaveCount(0);
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
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
  const count = Number((db.prepare("SELECT COUNT(*) count FROM tasks WHERE assignee='lead'").get() as { count: number }).count);
  db.close();
  return count;
}
function taskCount(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const count = Number((db.prepare("SELECT COUNT(*) count FROM tasks WHERE kind='root'").get() as { count: number }).count);
  db.close();
  return count;
}

async function conversationViewport(history: import("@playwright/test").Locator) {
  return history.evaluate((node) => {
    const viewportTop = node.getBoundingClientRect().top;
    const first = [...node.querySelectorAll<HTMLElement>("[data-chat-id]")]
      .find((item) => item.getBoundingClientRect().bottom >= viewportTop);
    return {
      firstVisible: first?.dataset.chatId,
      offset: first ? first.getBoundingClientRect().top - viewportTop : 0,
    };
  });
}

async function conversationAnchorOffset(history: import("@playwright/test").Locator, id?: string) {
  return history.evaluate((node, anchorId) => {
    const item = anchorId
      ? node.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(anchorId)}"]`)
      : null;
    return item ? item.getBoundingClientRect().top - node.getBoundingClientRect().top : undefined;
  }, id);
}

async function stableConversationViewport(history: import("@playwright/test").Locator) {
  return history.evaluate((node) => new Promise<{ firstVisible?: string; offset: number }>((resolve) => {
    let previous: { firstVisible?: string; offset: number } | undefined;
    let stableFrames = 0;
    const sample = () => {
      const viewportTop = node.getBoundingClientRect().top;
      const first = [...node.querySelectorAll<HTMLElement>("[data-chat-id]")]
        .find((item) => item.getBoundingClientRect().bottom >= viewportTop);
      const current = {
        firstVisible: first?.dataset.chatId,
        offset: first ? first.getBoundingClientRect().top - viewportTop : 0,
      };
      stableFrames = previous
        && previous.firstVisible === current.firstVisible
        && Math.abs(previous.offset - current.offset) <= 0.5
        ? stableFrames + 1
        : 0;
      previous = current;
      if (stableFrames >= 3) resolve(current);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}
