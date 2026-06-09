import { test, expect } from "@playwright/test";

// Global command palette: opens from the sidebar (or ⌘K), filters nav, and
// searches content. Route-mocked so it's DB- and model-independent.

test.describe("command palette", () => {
  test("opens from the sidebar and lists tools", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /command palette/i });
    await expect(dialog.getByPlaceholder(/search prompts/i)).toBeVisible();
    await expect(dialog.getByText("Prompt Optimizer")).toBeVisible();
    await expect(dialog.getByText("QA Pipeline")).toBeVisible();
  });

  test("filters tools by query", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /command palette/i });
    await dialog.getByPlaceholder(/search prompts/i).fill("memory");
    await expect(dialog.getByText("Memory")).toBeVisible();
    await expect(dialog.getByText("Email Writer")).toHaveCount(0);
  });

  test("searches content across entities (mocked)", async ({ page }) => {
    await page.route("**/api/search*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ type: "Task", id: "t1", title: "Ship the regression suite", subtitle: "doing", href: "/tools/tasks" }],
        }),
      })
    );
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /command palette/i });
    await dialog.getByPlaceholder(/search prompts/i).fill("regression");
    await expect(dialog.getByText("Ship the regression suite")).toBeVisible();
    await expect(dialog.getByText("Task", { exact: true })).toBeVisible();
  });
});
