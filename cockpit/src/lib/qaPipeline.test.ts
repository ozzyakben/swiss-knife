import { describe, it, expect } from "vitest";
import { parseVerdict, stripFences, deriveTitle } from "@/lib/qaPipeline";

describe("parseVerdict", () => {
  it("reads PASS / BLOCK case-insensitively", () => {
    expect(parseVerdict("Verdict: PASS")).toBe("PASS");
    expect(parseVerdict("verdict: pass")).toBe("PASS");
    expect(parseVerdict("Verdict: BLOCK")).toBe("BLOCK");
  });
  it("is UNKNOWN with no verdict line", () => {
    expect(parseVerdict("Looks good overall.")).toBe("UNKNOWN");
  });
  it("matches a verdict substring: 'Verdict: PASSED' -> PASS (documented behavior)", () => {
    expect(parseVerdict("Verdict: PASSED")).toBe("PASS");
  });
  it("requires the colon form: 'Verdict - PASS' -> UNKNOWN", () => {
    expect(parseVerdict("Verdict - PASS")).toBe("UNKNOWN");
  });
  it("is driven by the verdict line, not prose: prose 'passes' + 'Verdict: BLOCK' -> BLOCK", () => {
    expect(parseVerdict("The feature passes most checks.\nVerdict: BLOCK")).toBe("BLOCK");
  });
  it("checks BLOCK first: a stray 'verdict: pass…' substring can't beat a real BLOCK", () => {
    expect(parseVerdict("verdict: pass-criteria not met.\nVerdict: BLOCK")).toBe("BLOCK");
  });
});

describe("stripFences", () => {
  it("removes a ```gherkin opening fence and its closing fence", () => {
    expect(stripFences("```gherkin\nFeature: x\n```")).toBe("Feature: x");
  });
  it("removes bare ``` fences", () => {
    expect(stripFences("```\nFeature: x\n```")).toBe("Feature: x");
  });
  it("trims and returns fence-free content unchanged", () => {
    expect(stripFences("   Feature: x   ")).toBe("Feature: x");
  });
  it("removes a whitespace-padded own-line fence", () => {
    expect(stripFences("   ```   \nFeature: x")).toBe("Feature: x");
  });
  it("does NOT strip an inline (not own-line) backtick run", () => {
    expect(stripFences("Given x ```").includes("```")).toBe(true);
  });
});

describe("deriveTitle", () => {
  it("returns a short single line verbatim", () => {
    expect(deriveTitle("Pay for a cart")).toBe("Pay for a cart");
  });
  it("trims leading blank lines before taking the first line (not 'Untitled')", () => {
    expect(deriveTitle("\n\nReal title\nmore detail")).toBe("Real title");
  });
  it("falls back to 'Untitled story' for all-whitespace input", () => {
    expect(deriveTitle("   \n  \n ")).toBe("Untitled story");
  });
  it("keeps a 70-char line whole and truncates a 71-char line to 67 + ellipsis (len 68)", () => {
    const at70 = "x".repeat(70);
    expect(deriveTitle(at70)).toBe(at70);
    const at71 = "y".repeat(71);
    const out = deriveTitle(at71);
    expect(out).toBe("y".repeat(67) + "…");
    expect(out.length).toBe(68);
  });
  it("handles CRLF line endings", () => {
    expect(deriveTitle("First line\r\nsecond")).toBe("First line");
  });
});
