import { describe, it, expect } from "vitest";
import { tokenMatches } from "@/lib/captureAuth";

// This is the security gate for the headless capture/routine endpoints — a
// regression that dropped the length guard or matched empty strings would admit
// any token. Pin it.
describe("tokenMatches", () => {
  it("returns true only for an exact match", () => {
    expect(tokenMatches("s3cret", "s3cret")).toBe(true);
  });
  it("returns false for a different value of the same length", () => {
    expect(tokenMatches("aaaaaa", "bbbbbb")).toBe(false);
  });
  it("returns false on a length mismatch (no throw)", () => {
    expect(tokenMatches("abc", "abcd")).toBe(false);
    expect(tokenMatches("abcd", "abc")).toBe(false);
  });
  it("returns false for a missing provided token", () => {
    expect(tokenMatches(null, "s3cret")).toBe(false);
  });
  it("never admits an empty/blank configured token", () => {
    expect(tokenMatches("", "")).toBe(false); // empty configured -> never a match
    expect(tokenMatches("x", "")).toBe(false);
    expect(tokenMatches("", "x")).toBe(false);
  });
});
