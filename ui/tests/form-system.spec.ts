import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("shared form fields stay labelled, described, and responsive", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  const name = dialog.getByRole("textbox", { name: "Name" });
  const workspace = dialog.getByRole("button", { name: "Workspace" });

  await expect(name).toHaveAttribute("data-control", "input");
  await expect(name).toBeFocused();
  await expect(workspace).toHaveAttribute("aria-describedby");
  await expect(dialog.getByText("Choose the folder where this project and its agents will work.")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("settings and chat use the same control foundation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Global settings" }).click();
  const settings = page.getByRole("dialog", { name: "Global settings" });
  await expect(settings.getByLabel("Global default model")).toHaveAttribute("data-control", "select");
  await settings.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  const composer = page.getByRole("textbox", { name: "Message lead" });
  await expect(composer).toHaveAttribute("data-control", "textarea");
  await expect(composer).toHaveAttribute("data-control-variant", "bare");
});

test("agent creation, agent settings, and project settings share controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add agent" }).click();
  const createAgent = page.getByRole("dialog", { name: "New agent" });
  await expect(createAgent.getByLabel("Name")).toHaveAttribute("data-control", "input");
  await expect(createAgent.getByLabel("Role")).toHaveAttribute("data-control", "input");
  await expect(createAgent.getByLabel("Instructions")).toHaveAttribute("data-control", "textarea");
  await expect(createAgent.getByLabel("Model")).toHaveAttribute("data-control", "select");
  await createAgent.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Configure lead" }).click();
  const agent = page.getByRole("main", { name: "Lead" });
  await agent.getByRole("tab", { name: /Profile/ }).click();
  await expect(agent.getByLabel("Title")).toHaveAttribute("data-control", "input");
  await expect(agent.getByLabel("Description")).toHaveAttribute("data-control", "textarea");
  await agent.getByRole("tab", { name: "Model", exact: true }).click();
  await expect(agent.getByRole("combobox", { name: "Model" })).toHaveAttribute("data-control", "select");
  await agent.getByRole("button", { name: "Back to agents" }).click();

  const projectMenu = page.getByRole("button", { name: "More options for Persona test" });
  await projectMenu.click();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  const appearance = page.getByRole("dialog", { name: "Appearance · Persona test" });
  await expect(appearance.getByLabel("Persona test color")).toHaveAttribute("data-control", "input");
  await expect(appearance.getByRole("button", { name: "Persona test picture", exact: true })).toHaveAttribute("data-control", "input");
  await appearance.getByRole("button", { name: "Close" }).click();

  await projectMenu.click();
  await page.getByRole("menuitem", { name: "Project workflow" }).click();
  const workflow = page.getByRole("dialog", { name: "Project workflow" });
  await expect(workflow.getByRole("spinbutton", { name: "Maximum active work items" })).toHaveAttribute("data-control", "input");
  const ideaToggle = workflow.getByRole("checkbox").first();
  if (await ideaToggle.count()) await expect(ideaToggle).toHaveAttribute("data-control", "checkbox");
});
