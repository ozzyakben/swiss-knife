import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression net for applyMerge's embedding contract: an accepted merge
// changes the fact's WORDING, so on embed failure the stored embedding must
// become null (reindexFacts only scans embedding:null) — never the old vector
// ranking the fact by its old meaning.

const update = vi.fn();
const del = vi.fn();
const tx = vi.fn(async (ops: unknown[]) => ops);

vi.mock("@/lib/db", () => ({
  prisma: {
    memoryFact: {
      update: (...args: unknown[]) => update(...args),
      delete: (...args: unknown[]) => del(...args),
    },
    $transaction: (ops: unknown[]) => tx(ops),
  },
}));

const embedDocuments = vi.fn();
vi.mock("@/lib/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embeddings")>();
  return { ...actual, embedDocuments: (...args: unknown[]) => embedDocuments(...args) };
});

// memoryLoop pulls in ollama/config for the model steps applyMerge never uses.
vi.mock("@/lib/ollama", () => ({ chat: vi.fn(), chatJson: vi.fn() }));
vi.mock("@/lib/config", () => ({ getEffectiveConfig: vi.fn() }));

import { applyMerge } from "./memoryLoop";

describe("applyMerge embedding contract", () => {
  beforeEach(() => {
    update.mockClear();
    del.mockClear();
    tx.mockClear();
  });

  it("stores the new embedding when embedding succeeds", async () => {
    embedDocuments.mockResolvedValueOnce([[0.1, 0.2]]);
    await applyMerge("prop1", "target1", "merged wording");
    expect(update).toHaveBeenCalledWith({
      where: { id: "target1" },
      data: { value: "merged wording", embedding: JSON.stringify([0.1, 0.2]) },
    });
    expect(del).toHaveBeenCalledWith({ where: { id: "prop1" } });
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it("nulls the embedding on embed failure (never keeps the stale vector)", async () => {
    embedDocuments.mockRejectedValueOnce(new Error("embeddinggemma down"));
    await applyMerge("prop2", "target2", "new merged wording");
    expect(update).toHaveBeenCalledWith({
      where: { id: "target2" },
      data: { value: "new merged wording", embedding: null },
    });
    expect(del).toHaveBeenCalledWith({ where: { id: "prop2" } });
  });
});
