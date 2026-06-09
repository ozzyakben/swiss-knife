import { test, expect, type Page } from "@playwright/test";

// ── Mock fixtures (model-independent; the routes are stubbed) ────────────────
const lint = (ok: boolean) =>
  ok
    ? { issues: [], summary: { errors: 0, warnings: 0, scenarios: 1 }, ok: true }
    : {
        issues: [
          { severity: "ERROR", line: 4, message: "Scenario 'cash sale' has no tags." },
          { severity: "ERROR", line: 4, message: "exactly one event per scenario." },
        ],
        summary: { errors: 2, warnings: 0, scenarios: 1 },
        ok: false,
      };

const iteration = (order: number, ok: boolean, extra: Record<string, unknown> = {}) => ({
  id: `it_${order}`,
  order,
  instruction: order > 1 ? "add a boundary case" : null,
  draftFeature: `Feature: Demo ${order}\n\n  @valid @smoke @ui\n  Scenario: s${order}\n    Given a state\n    When an event happens\n    Then an outcome holds`,
  lint: lint(ok),
  rubric: ok ? { raw: "Verdict: PASS", verdict: "PASS" } : { raw: "Verdict: BLOCK", verdict: "BLOCK" },
  edited: false,
  createdAt: "2026-06-05T00:00:00.000Z",
  ...extra,
});

const session = (ok: boolean, iterations = [iteration(1, ok)]) => ({
  id: "sess_1",
  title: "As a cashier I want a tax-exempt cash sale",
  story: "As a cashier I want a tax-exempt cash sale at the point of sale.",
  projectId: "p1",
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
  iterations,
});

const summary = (ok: boolean) => ({
  id: "sess_1",
  title: "As a cashier I want a tax-exempt cash sale",
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
  iterationCount: 1,
  latest: { order: 1, lintOk: ok, errors: ok ? 0 : 2, warnings: 0, verdict: ok ? "PASS" : "BLOCK" },
});

const fulfill = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });

// Mock the list endpoint (GET) and the new-run endpoint (POST), same URL.
async function mockBase(page: Page, opts: { list?: unknown[]; post?: unknown }) {
  await page.route("**/api/qa-pipeline", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill(fulfill(opts.post ?? { needsPack: true, projectId: null }));
    }
    return route.fulfill(fulfill({ projectId: "p1", sessions: opts.list ?? [] }));
  });
}

test.describe("qa pipeline", () => {
  test("page loads with input, Run, and the saved-sessions section", async ({ page }) => {
    await mockBase(page, { list: [] });
    await page.goto("/tools/qa-pipeline");
    await expect(page.getByRole("heading", { name: /qa pipeline/i })).toBeVisible();
    await expect(page.getByPlaceholder(/paste a user story/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^run$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Saved sessions" })).toBeVisible();
    await expect(page.getByText(/no saved sessions yet/i)).toBeVisible();
  });

  test("import from ticket fills the story box (mocked)", async ({ page }) => {
    await mockBase(page, { list: [] });
    await page.route("**/api/qa-pipeline/ingest", (route) =>
      route.fulfill(
        fulfill({ title: "Partial ROA payment", story: "As a cashier, I want to accept a partial ROA payment, so that the balance updates." })
      )
    );
    await page.goto("/tools/qa-pipeline");
    await page.getByRole("button", { name: /import from ticket/i }).click();
    await page.getByPlaceholder(/paste the ticket/i).fill("LBMH01-4821 partial ROA payment at POS");
    await page.getByRole("button", { name: /extract story/i }).click();
    await expect(page.getByPlaceholder(/paste a user story/i)).toHaveValue(/partial ROA payment/i);
  });

  test("new run opens a session view with iteration 1 (lint PASS)", async ({ page }) => {
    await mockBase(page, { list: [], post: { needsPack: false, projectId: "p1", session: session(true) } });
    await page.goto("/tools/qa-pipeline");
    await page.getByPlaceholder(/paste a user story/i).fill("a tax-exempt cash sale");
    await page.getByRole("button", { name: /^run$/i }).click();

    await expect(page.getByText("Iteration 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Drafted .feature")).toBeVisible();
    await expect(page.getByText("lint PASS")).toBeVisible();
    await expect(page.getByText("rubric PASS")).toBeVisible();
    await expect(page.getByRole("button", { name: /refine/i })).toBeVisible();
    // Deterministic coverage panel flags the happy-path-only draft.
    await expect(page.getByText("Coverage", { exact: true })).toBeVisible();
    await expect(page.getByText(/No negative paths/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /negative paths/i })).toBeVisible();
  });

  test("a blocked run shows lint BLOCK", async ({ page }) => {
    await mockBase(page, { list: [], post: { needsPack: false, projectId: "p1", session: session(false) } });
    await page.goto("/tools/qa-pipeline");
    await page.getByPlaceholder(/paste a user story/i).fill("an under-specified sale");
    await page.getByRole("button", { name: /^run$/i }).click();

    await expect(page.getByText("lint BLOCK")).toBeVisible();
    await expect(page.getByText(/exactly one event per scenario/i)).toBeVisible();
  });

  test("no-pack project shows the empty state", async ({ page }) => {
    await mockBase(page, { list: [], post: { projectId: null, needsPack: true } });
    await page.goto("/tools/qa-pipeline");
    await page.getByPlaceholder(/paste a user story/i).fill("any story");
    await page.getByRole("button", { name: /^run$/i }).click();
    await expect(page.getByText(/no QA pack/i)).toBeVisible();
    await expect(page.getByText(/npm run seed:lbmh/i)).toBeVisible();
  });

  test("saved session opens from the history list", async ({ page }) => {
    await mockBase(page, { list: [summary(true)] });
    await page.route("**/api/qa-pipeline/sess_1", (route) => {
      if (route.request().method() === "GET") return route.fulfill(fulfill({ session: session(true) }));
      return route.fulfill(fulfill({ ok: true }));
    });
    await page.goto("/tools/qa-pipeline");
    await expect(page.getByText("As a cashier I want a tax-exempt cash sale")).toBeVisible();
    await page.getByText("As a cashier I want a tax-exempt cash sale").click();
    await expect(page.getByText("Iteration 1", { exact: true })).toBeVisible();
    await expect(page.getByText(/back to history/i)).toBeVisible();
  });

  test("refine appends iteration 2", async ({ page }) => {
    await mockBase(page, { list: [], post: { needsPack: false, projectId: "p1", session: session(true) } });
    await page.route("**/api/qa-pipeline/sess_1", (route) =>
      route.fulfill(fulfill({ needsPack: false, iteration: iteration(2, true) }))
    );
    await page.goto("/tools/qa-pipeline");
    await page.getByPlaceholder(/paste a user story/i).fill("a tax-exempt cash sale");
    await page.getByRole("button", { name: /^run$/i }).click();
    await expect(page.getByText("Iteration 1", { exact: true })).toBeVisible();

    await page.getByPlaceholder(/add a boundary case/i).fill("add a boundary case for over-tender");
    await page.getByRole("button", { name: /^refine$/i }).click();
    await expect(page.getByText("Iteration 2", { exact: true })).toBeVisible();
  });

  test("manual draft edit re-lints and marks the rubric stale", async ({ page }) => {
    await mockBase(page, { list: [], post: { needsPack: false, projectId: "p1", session: session(true) } });
    await page.route("**/api/qa-pipeline/iteration/it_1", (route) =>
      route.fulfill(
        fulfill({ iteration: iteration(1, false, { edited: true, rubric: null }) })
      )
    );
    await page.goto("/tools/qa-pipeline");
    await page.getByPlaceholder(/paste a user story/i).fill("a tax-exempt cash sale");
    await page.getByRole("button", { name: /^run$/i }).click();
    await expect(page.getByText("lint PASS")).toBeVisible();

    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.locator("textarea").first().fill("Feature: Hand edited\n  Scenario: x\n    When a\n    When b\n    Then c");
    await page.getByRole("button", { name: /save & re-lint/i }).click();

    await expect(page.getByText("lint BLOCK")).toBeVisible();
    await expect(page.getByText("rubric STALE")).toBeVisible();
    await expect(page.getByText("edited")).toBeVisible();
  });

  test("delete removes a session from the history list", async ({ page }) => {
    await mockBase(page, { list: [summary(true)] });
    await page.route("**/api/qa-pipeline/sess_1", (route) => route.fulfill(fulfill({ ok: true })));
    await page.goto("/tools/qa-pipeline");
    const row = page.getByText("As a cashier I want a tax-exempt cash sale");
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: /^delete$/i }).click();
    await expect(row).toHaveCount(0);
  });

  test("sidebar links to QA Pipeline", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "QA Pipeline", exact: true })).toBeVisible();
  });
});
