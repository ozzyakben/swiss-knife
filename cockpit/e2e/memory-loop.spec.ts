import { test, expect } from "@playwright/test";

// The memory loop UI, route-mocked so it's model- and DB-state-independent.

test.describe("memory loop", () => {
  test("memory page shows the loop controls", async ({ page }) => {
    await page.goto("/tools/memory");
    await expect(page.getByRole("heading", { name: /memory/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /suggest from text/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /from activity/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /reindex/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /classify/i })).toBeVisible();
    await expect(page.getByPlaceholder(/search facts/i)).toBeVisible();
    await expect(page.getByRole("combobox", { name: /filter by category/i })).toBeVisible();
    await expect(page.getByText("Relevance preview", { exact: true })).toBeVisible();
  });

  test("relevance preview ranks facts (mocked)", async ({ page }) => {
    await page.route("**/api/memory/context*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ranked: true,
          facts: [
            { id: "a", key: null, value: "POS means point of sale", category: "glossary", pinned: false, score: 0.91 },
            { id: "b", key: null, value: "Tax-exempt sales skip tax", category: "standard", pinned: false, score: 0.74 },
          ],
        }),
      })
    );
    await page.goto("/tools/memory");
    await page.getByPlaceholder(/Write a Gherkin scenario/i).fill("tax-exempt POS sale");
    await page.getByRole("button", { name: /^preview$/i }).click();

    await expect(page.getByText("POS means point of sale")).toBeVisible();
    await expect(page.getByText("91%")).toBeVisible();
    await expect(page.getByText(/cosine similarity/i)).toBeVisible();
  });

  test("learn from text posts to the loop (mocked)", async ({ page }) => {
    await page.route("**/api/memory/learn", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ created: 2, merges: 1, skipped: 0, candidates: [] }),
      })
    );
    await page.goto("/tools/memory");
    await page.getByRole("button", { name: /suggest from text/i }).click();
    await page.getByPlaceholder(/Paste notes/i).fill("POS is the point of sale screen. UOM is unit of measure.");
    await page.getByRole("button", { name: /^learn$/i }).click();

    await expect(page.getByText(/Captured: 2 new, 1 merge proposal/i)).toBeVisible();
  });
});
