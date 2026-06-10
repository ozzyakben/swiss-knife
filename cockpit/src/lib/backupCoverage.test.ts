import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

// Tripwire: every Prisma content model must be covered by BOTH /api/export and
// /api/import, or backups silently lose data (this exact bug shipped: Adr was
// added in the dev-tools round and fell out of the backup until 2026-06-10).
// A model that is intentionally NOT backed up belongs in EXCLUDED, with a reason.

const EXCLUDED = new Set([
  "Settings", // holds the capture token + OWUI key — secrets stay out of backups
  "ActivityLog", // append-only telemetry, not user content
  "QaIteration", // nested under QaSession in the export (handled explicitly)
]);

// Model name → the prisma client property the routes must reference.
const clientName = (model: string) => model[0].toLowerCase() + model.slice(1);

function schemaModels(): string[] {
  const schema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
  return [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((m) => m[1]);
}

describe("backup coverage", () => {
  const models = schemaModels().filter((m) => !EXCLUDED.has(m));
  const exportSrc = readFileSync(join(__dirname, "../app/api/export/route.ts"), "utf8");
  const importSrc = readFileSync(join(__dirname, "../app/api/import/route.ts"), "utf8");

  it("finds a plausible model list in the schema", () => {
    expect(models.length).toBeGreaterThanOrEqual(10);
    expect(models).toContain("Adr");
  });

  it.each(models)("/api/export reads %s", (model) => {
    expect(exportSrc).toMatch(new RegExp(`prisma\\.${clientName(model)}\\.findMany`));
  });

  it.each(models)("/api/import writes %s", (model) => {
    expect(importSrc).toMatch(new RegExp(`m\\.${clientName(model)}`));
  });
});
