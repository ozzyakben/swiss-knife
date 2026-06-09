import { describe, it, expect } from "vitest";
import { cosine, parseVector, serializeVector } from "@/lib/embeddings";

describe("serializeVector / parseVector round-trip", () => {
  it("parseVector(serializeVector(v)) deep-equals v (the storage contract)", () => {
    const v = [0.1, -2, 3.5, 0];
    expect(parseVector(serializeVector(v))).toEqual(v);
  });
});

describe("cosine", () => {
  it("is 1 for identical vectors", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
  it("is -1 for opposite vectors", () => {
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });
  it("is 0 when either vector is the zero vector (degenerate)", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 1], [0, 0])).toBe(0);
  });
  it("is 0 for empty vectors", () => {
    expect(cosine([], [])).toBe(0);
  });
  it("is 0 for mismatched dimensions (not a truncated partial score)", () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("parseVector", () => {
  it("parses a valid JSON number array", () => {
    expect(parseVector("[1,2,3]")).toEqual([1, 2, 3]);
  });
  it("returns null for null/undefined/empty string", () => {
    expect(parseVector(null)).toBeNull();
    expect(parseVector(undefined)).toBeNull();
    expect(parseVector("")).toBeNull();
  });
  it("returns null for invalid JSON", () => {
    expect(parseVector("{not json")).toBeNull();
  });
  it("returns null for non-arrays and the empty array", () => {
    expect(parseVector("5")).toBeNull();
    expect(parseVector('"x"')).toBeNull();
    expect(parseVector("[]")).toBeNull();
  });
  it("returns null when any element is not a finite number", () => {
    expect(parseVector('[1,"x",2]')).toBeNull(); // mixed
    expect(parseVector("[1,null,2]")).toBeNull(); // null element
    expect(parseVector("[1,1e999,2]")).toBeNull(); // Infinity
  });
});
