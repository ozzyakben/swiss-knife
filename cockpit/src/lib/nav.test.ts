import { readdirSync, existsSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { NAV_GROUPS, NAV_ITEMS } from "./nav";

// Registry tripwire: the sidebar, dashboard grid, AND command palette all
// derive from NAV_ITEMS — so a tool page that isn't registered is unreachable,
// and a registered href without a page is a dead link. This drifted twice
// before the palette was unified onto the registry.

const TOOLS_DIR = join(__dirname, "../app/tools");

describe("nav registry", () => {
  const toolDirs = readdirSync(TOOLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(TOOLS_DIR, d.name, "page.tsx")))
    .map((d) => d.name);
  const navToolHrefs = NAV_ITEMS.filter((i) => i.href.startsWith("/tools/")).map((i) => i.href);

  it.each(toolDirs)("tool page /tools/%s is registered in NAV_ITEMS", (dir) => {
    expect(navToolHrefs).toContain(`/tools/${dir}`);
  });

  it.each(navToolHrefs)("registered href %s has a page on disk", (href) => {
    const dir = href.replace("/tools/", "");
    expect(existsSync(join(TOOLS_DIR, dir, "page.tsx"))).toBe(true);
  });

  it("every tool belongs to a declared group", () => {
    const groupIds = new Set(NAV_GROUPS.map((g) => g.id));
    for (const item of NAV_ITEMS) {
      if (item.href === "/") continue; // Dashboard is deliberately ungrouped
      expect(item.group, `${item.label} needs a group`).toBeDefined();
      expect(groupIds.has(item.group!)).toBe(true);
    }
  });

  it("hrefs are unique", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
