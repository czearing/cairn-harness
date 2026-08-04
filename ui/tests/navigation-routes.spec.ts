import { expect, test } from "@playwright/test";

test("major dashboard surfaces have deep links and browser history", async ({ page }) => {
  const projects = await page.request.get("/api/projects").then((response) => response.json());
  const project = projects[0] as { id: string; agents: Array<{ id: string; isLeader?: boolean }> };
  const agent = project.agents.find((candidate) => candidate.isLeader) || project.agents[0];
  const base = `/projects/${encodeURIComponent(project.id)}`;

  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(base)}$`));
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Project workspace" })
    .getByRole("button", { name: "Recent activity" }).click();
  await expect(page).toHaveURL(`${base}/activity`);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(base)}$`));
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: `Configure ${agent.id}` }).click();
  await expect(page).toHaveURL(`${base}/agents/${encodeURIComponent(agent.id)}/settings`);
  await expect(page.getByRole("main", { name: new RegExp(agent.id, "i") })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(base)}$`));

  await page.getByRole("button", { name: `Open conversation with ${agent.id}` }).click();
  await expect(page).toHaveURL(`${base}/agents/${encodeURIComponent(agent.id)}`);
  await expect(page.locator("[data-app-shell]")).toHaveAttribute("data-route-pathname", `${base}/agents/${encodeURIComponent(agent.id)}`);
  await expect(page.locator("[data-app-shell]")).toHaveAttribute("data-route-kind", "conversation");
  await expect(page.locator("[data-app-shell]")).toHaveAttribute("data-chat-agent", agent.id);
  await expect(page.getByRole("dialog", { name: new RegExp(`Conversation with`, "i") })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto(`${base}/agents/${encodeURIComponent(agent.id)}/settings`);
  await expect(page.getByRole("main", { name: new RegExp(agent.id, "i") })).toBeVisible();
});

test("drafts and settings expose canonical URLs", async ({ page }) => {
  const projects = await page.request.get("/api/projects").then((response) => response.json());
  const project = projects[0] as { id: string };
  const base = `/projects/${encodeURIComponent(project.id)}`;
  await page.goto(base);

  await page.getByRole("button", { name: "New task" }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(base)}/drafts/[^/]+$`));

  await page.getByRole("button", { name: "Global settings" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("dialog", { name: "Global settings" })).toBeVisible();
});

test("conversation deep links render the selected agent", async ({ page }) => {
  const projects = await page.request.get("/api/projects").then((response) => response.json());
  const project = projects[0] as { id: string; agents: Array<{ id: string }> };
  const agent = project.agents[0];
  await page.goto(`/projects/${encodeURIComponent(project.id)}/agents/${encodeURIComponent(agent.id)}`);
  await expect(page.getByRole("dialog", { name: /Conversation with/i })).toBeVisible();
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
