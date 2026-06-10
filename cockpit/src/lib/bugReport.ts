// Deterministic completeness gate for bug reports (the lint-pattern sibling of
// adrLint/gherkinLint). Pure + unit-tested; the route applies it to both the
// model's draft and a user-reviewed draft being persisted.

export type BugDraft = {
  title?: string;
  repro?: string[];
  expected?: string;
  actual?: string;
  severity?: string;
  environment?: string | null;
};

export type CheckedReport = {
  title: string;
  repro: string[];
  expected: string;
  actual: string;
  severity: string;
  environment: string | null;
  missing: string[];
};

const SEVERITIES = ["low", "medium", "high", "critical"];

export function checkReport(r: BugDraft): CheckedReport {
  const repro = (r.repro ?? []).map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  const missing: string[] = [];
  if (!r.title?.trim()) missing.push("title");
  if (repro.length === 0) missing.push("reproduction steps");
  if (!r.expected?.trim()) missing.push("expected");
  if (!r.actual?.trim()) missing.push("actual");
  return {
    title: r.title?.trim() ?? "",
    repro,
    expected: r.expected?.trim() ?? "",
    actual: r.actual?.trim() ?? "",
    severity: SEVERITIES.includes(r.severity ?? "") ? (r.severity as string) : "medium",
    environment: r.environment?.trim() || null,
    missing,
  };
}
