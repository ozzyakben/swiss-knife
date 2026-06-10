import { test, expect, type Page } from "@playwright/test";

// The Big-O estimate now lives INSIDE Code Review (the standalone Complexity
// page was folded in). Model-independent: /api/complexity (chatJson) and
// /api/complexity-derivation (stream) are route-mocked.

const RESULT = {
  verdict: {
    timeBigO: "O(n^2)",
    spaceBigO: "O(1)",
    hotspots: [{ line: 3, note: "Inner loop re-scans the whole array per element." }],
  },
  scan: { functions: [], maxLoopDepth: 2, hasRecursion: false, hasSort: false, lines: 8 },
  warnings: [],
  ok: true,
};

async function mockApis(page: Page, result: unknown) {
  await page.route("**/api/complexity", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(result) })
  );
  await page.route("**/api/complexity-derivation", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "The outer loop contributes a factor of n; the inner loop another n.",
    })
  );
}

test.describe("big-O estimate (inside Code Review)", () => {
  test("the standalone complexity page is gone; Code Review hosts the section", async ({ page }) => {
    const res = await page.goto("/tools/complexity");
    expect(res?.status()).toBe(404);
    await page.goto("/tools/code-review");
    await expect(page.getByRole("button", { name: /estimate big-o/i })).toBeVisible();
  });

  test("renders verdict, scan facts, hotspots; derivation is opt-in and streams", async ({ page }) => {
    await mockApis(page, RESULT);
    await page.goto("/tools/code-review");
    await page.getByPlaceholder(/paste ts\/js code/i).fill("for (a) { for (b) { use(a, b); } }");
    await page.getByRole("button", { name: /estimate big-o/i }).click();

    await expect(page.getByText("time O(n^2)")).toBeVisible();
    await expect(page.getByText("space O(1)")).toBeVisible();
    await expect(page.getByText("scan-consistent")).toBeVisible();
    await expect(page.getByText(/inner loop re-scans/i)).toBeVisible();

    // The slow streamed derivation never auto-runs; it's a second explicit click.
    await expect(page.getByText(/outer loop contributes a factor/i)).toHaveCount(0);
    await page.getByRole("button", { name: /derive step-by-step/i }).click();
    await expect(page.getByText(/outer loop contributes a factor/i)).toBeVisible();
  });

  test("flags a questionable claim", async ({ page }) => {
    await mockApis(page, {
      ...RESULT,
      scan: { ...RESULT.scan, maxLoopDepth: 0 },
      warnings: [
        {
          severity: "WARN",
          message: "Claimed O(n^2), but the static scan found no loops, no recursion, and no sort calls.",
        },
      ],
      ok: false,
    });
    await page.goto("/tools/code-review");
    await page.getByPlaceholder(/paste ts\/js code/i).fill("const x = a + b;");
    await page.getByRole("button", { name: /estimate big-o/i }).click();

    await expect(page.getByText("questionable claim")).toBeVisible();
    await expect(page.getByText(/no loops, no recursion/i)).toBeVisible();
  });

  test("surfaces a clear error when the engine is down", async ({ page }) => {
    await page.route("**/api/complexity", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Ollama isn't running. Start the Ollama app (open -a Ollama) and try again.",
          reason: "ollama_down",
        }),
      })
    );
    await page.goto("/tools/code-review");
    await page.getByPlaceholder(/paste ts\/js code/i).fill("x");
    await page.getByRole("button", { name: /estimate big-o/i }).click();
    await expect(page.getByText(/ollama isn't running/i)).toBeVisible();
  });
});
