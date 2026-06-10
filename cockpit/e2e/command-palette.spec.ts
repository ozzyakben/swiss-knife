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
    await expect(dialog.getByText("Memory", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Email Writer")).toHaveCount(0);
  });

  test("offers natural-language quick-add and creates the item (mocked)", async ({ page }) => {
    await page.route("**/api/search*", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [] }) })
    );
    await page.route("**/api/quick-add", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ kind: "task", id: "t9", title: "File the POS bug", href: "/tools/tasks", deleteUrl: "/api/tasks/t9" }),
      })
    );
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /command palette/i });
    await dialog.getByPlaceholder(/search prompts/i).fill("file the POS bug");
    await expect(dialog.getByText(/Add/)).toBeVisible();
    await dialog.getByText(/Add/).click();
    await expect(page.getByText(/Added task: File the POS bug/i)).toBeVisible();
  });

  test("quick-added facts surface the pending-review state (mocked)", async ({ page }) => {
    await page.route("**/api/search*", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [] }) })
    );
    await page.route("**/api/quick-add", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          kind: "fact",
          pending: true,
          id: "f9",
          title: "Staging DB resets nightly",
          href: "/tools/memory",
          deleteUrl: "/api/memory/f9",
        }),
      })
    );
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /command palette/i });
    await dialog.getByPlaceholder(/search prompts/i).fill("staging DB resets nightly");
    await dialog.getByText(/Add/).click();
    await expect(page.getByText(/Fact queued for review: Staging DB resets nightly/i)).toBeVisible();
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
