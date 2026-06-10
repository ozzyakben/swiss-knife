import { test, expect } from "@playwright/test";

// These tests are model-independent: anything that would hit the live model is
// mocked, so they pass with or without Ollama running.

test.describe("cockpit foundation", () => {
  test("dashboard renders with navigation", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /good (morning|afternoon|evening)|working late/i })
    ).toBeVisible();
    // Sidebar nav links (exact, to avoid matching the dashboard card link).
    await expect(page.getByRole("link", { name: "Prompt Optimizer", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  });

  test("prompt optimizer tool loads", async ({ page }) => {
    await page.goto("/tools/prompt-optimizer");
    await expect(page.getByRole("heading", { name: /prompt optimizer/i })).toBeVisible();
    await expect(page.getByPlaceholder(/paste a rough prompt/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^optimize$/i })).toBeVisible();
  });

  test("dark mode toggles the html class", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: /toggle theme/i });

    // Retry opening the menu to absorb the hydration window on the toggle.
    await expect(async () => {
      await toggle.click();
      await expect(page.getByRole("menuitem", { name: /^dark$/i })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    await page.getByRole("menuitem", { name: /^dark$/i }).click();
    await expect(html).toHaveClass(/dark/);
  });

  test("dashboard shows the engine-offline banner when Ollama is down", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          reason: "ollama_down",
          model: "gemma4:12b-mlx",
          baseUrl: "http://localhost:11434/v1",
        }),
      })
    );
    await page.goto("/");
    await expect(page.getByText(/engine offline/i)).toBeVisible();
  });
});

test.describe("prompt optimizer (mocked engine)", () => {
  test("surfaces a clear error when the engine is down", async ({ page }) => {
    await page.route("**/api/optimize", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Ollama isn't running. Start the Ollama app (open -a Ollama) and try again.",
          reason: "ollama_down",
        }),
      })
    );
    await page.goto("/tools/prompt-optimizer");
    await page.getByPlaceholder(/paste a rough prompt/i).fill("make this better");
    await page.getByRole("button", { name: /^optimize$/i }).click();
    await expect(page.getByText(/ollama isn't running/i)).toBeVisible();
  });

  test("streams a mocked optimized prompt into the output", async ({ page }) => {
    await page.route("**/api/optimize", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "Improved: do X with constraints Y and a clear output format Z.",
      })
    );
    await page.goto("/tools/prompt-optimizer");
    await page.getByPlaceholder(/paste a rough prompt/i).fill("do x");
    await page.getByRole("button", { name: /^optimize$/i }).click();
    await expect(page.getByText(/optimized prompt/i)).toBeVisible();
    await expect(page.getByText(/improved: do x/i)).toBeVisible();
  });

  test("saves the visible result AFTER the run (no pre-commit save)", async ({ page }) => {
    await page.route("**/api/optimize", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "Improved: a sharp reviewed prompt.",
      })
    );
    let savedBody: unknown = null;
    await page.route("**/api/prompts", (route) => {
      savedBody = route.request().postDataJSON();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ prompt: { id: "p1" } }) });
    });
    await page.goto("/tools/prompt-optimizer");
    await page.getByPlaceholder(/paste a rough prompt/i).fill("rough prompt");
    // No save button before a result exists.
    await expect(page.getByRole("button", { name: /save to library/i })).toHaveCount(0);
    await page.getByRole("button", { name: /^optimize$/i }).click();
    await expect(page.getByText(/sharp reviewed prompt/i)).toBeVisible();
    await page.getByRole("button", { name: /save to library/i }).click();
    await expect(page.getByRole("button", { name: /saved/i })).toBeVisible();
    // What was saved is exactly what was on screen.
    expect(savedBody).toMatchObject({
      original: "rough prompt",
      optimized: "Improved: a sharp reviewed prompt.",
    });
  });
});
