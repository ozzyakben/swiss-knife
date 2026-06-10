import { describe, expect, it } from "vitest";

import { auditClaim, classifyBigO, maxLoopNesting, scanComplexity, withGrowthWarnings } from "./complexity";
import { scanCode } from "./codeSmells";

describe("maxLoopNesting", () => {
  it("counts nested loops", () => {
    expect(maxLoopNesting(`{ for (a) { for (b) { x(); } } }`)).toBe(2);
  });

  it("does not stack sequential loops", () => {
    expect(maxLoopNesting(`{ for (a) { x(); } for (b) { y(); } }`)).toBe(1);
  });

  it("counts iteration callbacks as loops", () => {
    expect(maxLoopNesting(`{ items.forEach((i) => { rows.map((r) => { z(); }); }); }`)).toBe(2);
  });

  it("does not stack sequential braceless arrow callbacks", () => {
    expect(maxLoopNesting(`{ const a = xs.map(x => x * 2); const b = ys.filter(y => y > 0); }`)).toBe(1);
  });

  it("still nests braceless callbacks inside each other", () => {
    expect(maxLoopNesting(`{ const m = xs.map(x => ys.map(y => x + y)); }`)).toBe(2);
  });
});

describe("scanComplexity", () => {
  it("finds loop depth, recursion, and sort per function", () => {
    const src = `
function bubble(arr) {
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length; j++) {
      if (arr[j] > arr[j + 1]) { swap(arr, j); }
    }
  }
  return arr;
}
function fib(n) {
  if (n < 2) { return n; }
  return fib(n - 1) + fib(n - 2);
}
function tidy(list) {
  return list.sort((a, b) => a - b);
}
`;
    const scan = scanComplexity(src);
    const by = Object.fromEntries(scan.functions.map((f) => [f.name, f]));
    expect(by.bubble.loopDepth).toBe(2);
    expect(by.bubble.recursive).toBe(false);
    expect(by.fib.recursive).toBe(true);
    expect(by.tidy.callsSort).toBe(true);
    expect(scan.maxLoopDepth).toBe(2);
    expect(scan.hasRecursion).toBe(true);
    expect(scan.hasSort).toBe(true);
  });

  it("ignores loop keywords inside strings and comments", () => {
    const scan = scanComplexity(`function f() {\n  // for (a) { for (b) {} }\n  const s = "while (x) {}";\n  return s;\n}`);
    expect(scan.maxLoopDepth).toBe(0);
    expect(scan.hasRecursion).toBe(false);
  });
});

describe("classifyBigO", () => {
  it("classifies the common notations", () => {
    expect(classifyBigO("O(1)")).toBe("constant");
    expect(classifyBigO("O(log n)")).toBe("logarithmic");
    expect(classifyBigO("O(n)")).toBe("linear");
    expect(classifyBigO("O(n + m)")).toBe("linear");
    expect(classifyBigO("O(n log n)")).toBe("linearithmic");
    expect(classifyBigO("O(n*log n)")).toBe("linearithmic");
    expect(classifyBigO("O(n · log n)")).toBe("linearithmic");
    expect(classifyBigO("O(n × log n)")).toBe("linearithmic");
    expect(classifyBigO("O(n^2)")).toBe("polynomial");
    expect(classifyBigO("O(n²)")).toBe("polynomial");
    expect(classifyBigO("O(n*m)")).toBe("polynomial");
    expect(classifyBigO("O(2^n)")).toBe("exponential");
    expect(classifyBigO("roughly quadratic")).toBe("unknown");
  });
});

describe("auditClaim", () => {
  const flat = scanComplexity(`function pick(o) {\n  return o.a + o.b;\n}`);
  const nested = scanComplexity(
    `function m(a) {\n  for (const x of a) {\n    for (const y of a) {\n      use(x, y);\n    }\n  }\n}`
  );

  it("warns on a super-linear claim with no mechanisms", () => {
    const issues = auditClaim(flat, "O(n^2)");
    expect(issues.length).toBe(1);
    expect(issues[0].message).toMatch(/no loops, no recursion/);
  });

  it("accepts a quadratic claim over nested loops", () => {
    expect(auditClaim(nested, "O(n^2)")).toEqual([]);
  });

  it("warns on an O(1) claim over nested loops", () => {
    const issues = auditClaim(nested, "O(1)");
    expect(issues.some((i) => /optimistic/.test(i.message))).toBe(true);
  });

  it("accepts n log n when a sort is present", () => {
    const sorty = scanComplexity(`function s(a) {\n  return a.sort();\n}`);
    expect(auditClaim(sorty, "O(n log n)")).toEqual([]);
  });

  it("trusts recursion for any bound", () => {
    const rec = scanComplexity(`function fib(n) {\n  if (n < 2) { return n; }\n  return fib(n - 1) + fib(n - 2);\n}`);
    expect(auditClaim(rec, "O(2^n)")).toEqual([]);
  });

  it("warns on unparseable notation", () => {
    expect(auditClaim(flat, "pretty fast")[0].message).toMatch(/Couldn't parse/);
  });
});

describe("withGrowthWarnings", () => {
  const triple = `function deep(xs) {
  for (const a of xs) {
    for (const b of xs) {
      for (const c of xs) {
        use(a, b, c);
      }
    }
  }
}`;

  it("adds a WARN for 3-deep nested iteration with the function's line", () => {
    const base = scanCode(triple);
    const out = withGrowthWarnings(base, triple);
    const growth = out.issues.filter((i) => i.rule === "growth");
    expect(growth).toHaveLength(1);
    expect(growth[0].severity).toBe("WARN");
    expect(growth[0].message).toMatch(/O\(n\^3\)/);
    expect(out.summary.warnings).toBe(base.summary.warnings + 1);
    expect(out.ok).toBe(base.ok); // advisory: never flips the gate
  });

  it("flags bare top-level nesting at line 1", () => {
    const bare = `for (a) { for (b) { for (c) { x(); } } }`;
    const out = withGrowthWarnings(scanCode(bare), bare);
    const growth = out.issues.filter((i) => i.rule === "growth");
    expect(growth).toHaveLength(1);
    expect(growth[0].line).toBe(1);
  });

  it("stays silent below 3-deep and on growth-free diffs", () => {
    const double = `function d(xs) {\n  for (const a of xs) {\n    for (const b of xs) { use(a, b); }\n  }\n}`;
    expect(withGrowthWarnings(scanCode(double), double).issues.filter((i) => i.rule === "growth")).toHaveLength(0);
    const diff = `--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@\n+const x = 1;\n`;
    const diffScan = scanCode(diff);
    expect(withGrowthWarnings(diffScan, diff)).toBe(diffScan);
  });

  it("flags 3-deep iteration introduced by a diff, at new-file lines", () => {
    // Diffs are Code Review's primary daily input — growth detection must not
    // be a raw-paste-only feature.
    const added = [
      "function hot(xs) {",
      "  for (const a of xs) {",
      "    for (const b of xs) {",
      "      for (const c of xs) {",
      "        use(a, b, c);",
      "      }",
      "    }",
      "  }",
      "}",
    ];
    const diff =
      `--- a/f.ts\n+++ b/f.ts\n@@ -1,0 +120,9 @@\n` + added.map((l) => `+${l}`).join("\n") + "\n";
    const out = withGrowthWarnings(scanCode(diff), diff);
    const growth = out.issues.filter((i) => i.rule === "growth");
    expect(growth).toHaveLength(1);
    expect(growth[0].message).toMatch(/O\(n\^3\)/);
    expect(growth[0].line).toBe(120); // new-file line of the function header
  });

  it("does not blame growth on context lines a one-line edit didn't introduce", () => {
    // The 3-deep loops arrive as unchanged context; only `use(...)` is added.
    // A growth WARN here pins O(n^3) on code the diff didn't touch.
    const rows = [
      " function hot(xs) {",
      "   for (const a of xs) {",
      "     for (const b of xs) {",
      "       for (const c of xs) {",
      "+        use(a, b, c);",
      "       }",
      "     }",
      "   }",
      " }",
    ];
    const diff = `--- a/f.ts\n+++ b/f.ts\n@@ -1,8 +1,9 @@\n` + rows.join("\n") + "\n";
    const out = withGrowthWarnings(scanCode(diff), diff);
    expect(out.issues.filter((i) => i.rule === "growth")).toHaveLength(0);
  });
});
