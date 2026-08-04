import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("block controls always return content to body text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  const textStyle = page.getByRole("button", { name: "Text style" });
  const bullet = page.getByRole("button", { name: "Bulleted list" });
  const checklist = page.getByRole("button", { name: "Checklist" });

  await editor.fill("Recoverable text");
  await bullet.click();
  await expect(editor.locator("li")).toHaveText("Recoverable text");
  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Body text" }).click();
  await expect(editor.locator("p")).toHaveText("Recoverable text");

  await checklist.click();
  await expect(editor.locator("li")).toHaveText("Recoverable text");
  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Body text" }).click();
  await expect(editor.locator("p")).toHaveText("Recoverable text");

  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
  await expect(editor.locator("h2")).toHaveText("Recoverable text");
  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Body text" }).click();
  await expect(editor.locator("p")).toHaveText("Recoverable text");
  await expect(textStyle).toContainText("Body");

  await textStyle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Bold" })).toBeFocused();
  const accessibility = await new AxeBuilder({ page }).include('[role="toolbar"]').analyze();
  expect(accessibility.violations).toEqual([]);
});

test("editor exposes practical Markdown blocks, lists, links, and inline formats", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New task" }).click();
  const editor = page.getByRole("textbox", { name: "Draft document" });
  const textStyle = page.getByRole("button", { name: "Text style" });
  const more = page.getByRole("button", { name: "More formatting" });

  await editor.fill("Launch notes");
  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Heading 1" }).click();
  await expect(editor.locator("h1")).toHaveText("Launch notes");

  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Quote" }).click();
  await expect(editor.locator("blockquote")).toHaveText("Launch notes");

  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Code block" }).click();
  await expect(editor.locator("code")).toHaveText("Launch notes");

  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Body text" }).click();
  await more.click();
  await page.getByRole("menuitemcheckbox", { name: "Numbered list" }).click();
  await expect(editor.locator("ol li")).toHaveText("Launch notes");

  await textStyle.click();
  await page.getByRole("menuitemradio", { name: "Body text" }).click();
  await editor.selectText();
  await page.getByRole("button", { name: "Link" }).click();
  await page.getByRole("textbox", { name: "Link URL" }).fill("example.com/docs");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com/docs");
  await editor.selectText();
  await page.getByRole("button", { name: "Link" }).click();
  await page.getByRole("textbox", { name: "Link URL" }).fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Enter a valid web, email, phone, anchor, or relative URL.")).toBeVisible();
  await page.getByRole("textbox", { name: "Link URL" }).press("Escape");

  await editor.selectText();
  await more.click();
  await page.getByRole("menuitemcheckbox", { name: "Strikethrough" }).click();
  await expect(editor.locator("span.md-strikethrough")).toHaveText("Launch notes");

  await more.click();
  await page.getByRole("menuitem", { name: "Undo" }).click();
  await expect(editor.locator("span.md-strikethrough")).toHaveCount(0);
});

test("prompt editor preserves readable body typography", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversation with lead" }).click();
  await page.getByRole("button", { name: "Edit agent" }).click();
  const editor = page.getByRole("textbox", { name: "Lead prompt instructions" });
  const paragraph = editor.locator("p").first();
  await expect(paragraph).toBeVisible();

  const metrics = await paragraph.evaluate((node) => {
    const editor = node.closest('[contenteditable="true"]') as HTMLElement;
    const text = getComputedStyle(node);
    const surface = getComputedStyle(editor);
    return {
      fontFamily: text.fontFamily,
      fontSize: Number.parseFloat(text.fontSize),
      lineHeight: Number.parseFloat(text.lineHeight),
      color: text.color,
      background: surface.backgroundColor,
      width: editor.getBoundingClientRect().width,
    };
  });
  expect(metrics.fontFamily).not.toContain("Times New Roman");
  expect(metrics.fontSize).toBeGreaterThanOrEqual(16);
  expect(metrics.lineHeight / metrics.fontSize).toBeGreaterThanOrEqual(1.5);
  expect(metrics.width).toBeLessThanOrEqual(761);
  expect(contrast(metrics.color, metrics.background)).toBeGreaterThanOrEqual(7);

  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/\d+/g)?.slice(0, 3).map(Number) || [];
    const linear = channels.map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
