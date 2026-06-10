import { describe, expect, it } from "vitest";

import { checkReport } from "./bugReport";

describe("checkReport", () => {
  const full = {
    title: "POS rejects partial ROA payment",
    repro: ["Open POS", "Take a payment below the balance"],
    expected: "Payment accepted, oldest invoice first",
    actual: "Error toast; payment rejected",
    severity: "high",
    environment: "POS 4.2",
  };

  it("passes a complete report through unchanged", () => {
    const r = checkReport(full);
    expect(r.missing).toEqual([]);
    expect(r.repro).toHaveLength(2);
    expect(r.severity).toBe("high");
    expect(r.environment).toBe("POS 4.2");
  });

  it("lists every missing field", () => {
    const r = checkReport({ severity: "high" });
    expect(r.missing).toEqual(["title", "reproduction steps", "expected", "actual"]);
  });

  it("treats whitespace-only fields and steps as missing", () => {
    const r = checkReport({ ...full, expected: "   ", repro: ["  ", ""] });
    expect(r.missing).toContain("expected");
    expect(r.missing).toContain("reproduction steps");
  });

  it("falls back to medium on an invalid severity and null environment", () => {
    const r = checkReport({ ...full, severity: "catastrophic", environment: "  " });
    expect(r.severity).toBe("medium");
    expect(r.environment).toBeNull();
  });
});
