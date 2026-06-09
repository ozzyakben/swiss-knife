import { test, expect } from "@playwright/test";

// The sidebar collapses to a hamburger + drawer below md (768px).

test.describe("responsive sidebar", () => {
  test("mobile shows a hamburger; the drawer opens and navigates", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");

    const openMenu = page.getByRole("button", { name: /open menu/i });
    await expect(openMenu).toBeVisible();
    // The persistent sidebar is hidden below md (its links are not visible).
    await expect(page.getByRole("link", { name: "Prompt Optimizer", exact: true })).toBeHidden();

    await openMenu.click();
    const drawer = page.getByRole("complementary", { name: "Mobile navigation" });
    await expect(drawer.getByRole("link", { name: "Gherkin Lint", exact: true })).toBeVisible();

    await drawer.getByRole("link", { name: "Gherkin Lint", exact: true }).click();
    await expect(page.getByRole("heading", { name: /gherkin lint/i })).toBeVisible();
    // Navigation closes the drawer.
    await expect(drawer).toBeHidden();
  });

  test("desktop keeps the persistent sidebar and no hamburger", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /open menu/i })).toBeHidden();
    await expect(
      page
        .getByRole("complementary", { name: "Sidebar" })
        .getByRole("link", { name: "Prompt Optimizer", exact: true })
    ).toBeVisible();
  });
});
