import { test, expect } from "@playwright/test";

// Filters persist via localStorage (sk:tasks:*) and badges act as filter chips.
// Real DB camp: tasks are created through the UI with unique titles.

test.describe("dx: persisted filters + chips", () => {
  test("priority filter and view tab survive a reload", async ({ page }) => {
    await page.goto("/tools/tasks");

    await page.getByRole("combobox", { name: "Filter by priority" }).click();
    await page.getByRole("option", { name: "high" }).click();
    await page.getByRole("tab", { name: "List" }).click();

    await page.reload();

    await expect(page.getByRole("combobox", { name: "Filter by priority" })).toContainText("high");
    await expect(page.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");

    // Clear for other tests/sessions.
    await page.getByRole("button", { name: /clear/i }).click();
    await expect(page.getByRole("combobox", { name: "Filter by priority" })).toContainText(
      "Any priority"
    );
  });

  test("clicking a priority badge in the list filters by it", async ({ page }) => {
    const title = `Chip task ${Date.now()}`;
    await page.goto("/tools/tasks");
    await page.getByPlaceholder(/add a task/i).fill(title);
    await page.getByRole("button", { name: /^add$/i }).click();

    await page.getByRole("tab", { name: "List" }).click();
    const row = page
      .locator("div")
      .filter({ hasText: title })
      .filter({ has: page.getByRole("button", { name: "Edit task" }) })
      .last();
    await row.getByTitle(/filter by medium priority/i).click();

    await expect(page.getByRole("combobox", { name: "Filter by priority" })).toContainText("medium");

    // Cleanup: clear the filter and delete the created task.
    await page.getByRole("button", { name: /clear/i }).click();
    await row.getByRole("button", { name: "Delete task" }).click();
  });
});
