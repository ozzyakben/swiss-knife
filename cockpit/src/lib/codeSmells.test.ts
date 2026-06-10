import { describe, expect, it } from "vitest";

import {
  countDecisions,
  detectForeignLanguage,
  findFunctions,
  looksLikeDiff,
  parseDiffHunks,
  scanCode,
  stripCode,
} from "./codeSmells";

describe("stripCode", () => {
  it("preserves line count and blanks string contents", () => {
    const src = `const a = "if (x) { while (y) }";\nconst b = 'for of';\n`;
    const out = stripCode(src);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).not.toMatch(/\bwhile\b/);
    expect(out).not.toMatch(/\bfor\b/);
    expect(out).toContain("const a =");
  });

  it("strips line and block comments", () => {
    const out = stripCode(`x(); // if (dead) {}\n/* for (;;) {} */ y();`);
    expect(out).not.toMatch(/\bif\b/);
    expect(out).not.toMatch(/\bfor\b/);
    expect(out).toContain("x();");
    expect(out).toContain("y();");
  });

  it("keeps template expressions as code but blanks literal text", () => {
    const out = stripCode("const t = `count: ${items.length > 3 ? n : m}`;");
    expect(out).toContain("items.length");
    expect(out).not.toContain("count:");
  });

  it("consumes regex literals so their contents can't open strings", () => {
    const src = `const re = /["']/g;\nif (x) { y(); }`;
    const out = stripCode(src);
    expect(out).toMatch(/\bif\b/); // the if after the regex survives
    expect(out).not.toContain('"');
  });

  it("does not treat division as a regex", () => {
    const out = stripCode("const r = (a + b) / 2; if (r) { }");
    expect(out).toContain("/ 2");
    expect(out).toMatch(/\bif\b/);
  });

  it("handles a regex literal at statement start after a comment line", () => {
    // The quote inside the regex must not open a string that swallows code.
    const src = `// strip quotes\n/['"]/.test(s);\nconst y = 777;`;
    const out = stripCode(src);
    expect(out).toContain("777");
    expect(out).toContain(".test(s);");
    expect(out).not.toContain("'");
  });
});

describe("findFunctions", () => {
  it("finds declarations, arrows, and methods with param counts", () => {
    const src = stripCode(`
function alpha(a, b) { return a + b; }
const beta = async (x, { y, z }, w) => { return x; };
class C {
  gamma(p1, p2, p3, p4) { return p1; }
}
`);
    const fns = findFunctions(src);
    const byName = Object.fromEntries(fns.map((f) => [f.name, f]));
    expect(byName.alpha.params).toBe(2);
    expect(byName.beta.params).toBe(3); // destructured param counts once
    expect(byName.gamma.params).toBe(4);
  });

  it("does not mistake control flow for functions", () => {
    const fns = findFunctions(stripCode(`if (x) { y(); }\nwhile (z) { y(); }\nswitch (k) { default: break; }`));
    expect(fns.length).toBe(0);
  });
});

describe("countDecisions", () => {
  it("counts branches, loops, logical operators, and ternaries", () => {
    // if + for + && + || + ternary + ?? = 6
    expect(countDecisions("if (a && b || c) { for (;;) { x = a ? 1 : 2; y = a ?? b; } }")).toBe(6);
  });

  it("does not count optional chaining or TS optional params", () => {
    expect(countDecisions("const v = a?.b?.c; function f(x?: number) {}")).toBe(0);
  });
});

describe("scanCode — raw code rules", () => {
  it("passes clean code", () => {
    const r = scanCode(`function add(a, b) {\n  return a + b;\n}\n`);
    expect(r.ok).toBe(true);
    expect(r.issues.length).toBe(0);
    expect(r.summary.functions).toBe(1);
    expect(r.summary.mode).toBe("code");
  });

  it("warns then errors on cyclomatic complexity", () => {
    const branches = (n: number) =>
      `function busy(x) {\n${Array.from({ length: n }, (_, i) => `  if (x === ${i + 3}) { x += 1; }`).join("\n")}\n  return x;\n}`;
    // 12 ifs (+ magic numbers, ignore those) → complexity 13 → WARN
    const warn = scanCode(branches(12));
    expect(warn.issues.some((i) => i.rule === "cyclomatic" && i.severity === "WARN")).toBe(true);
    // 16 ifs → complexity 17 → ERROR
    const err = scanCode(branches(16));
    expect(err.issues.some((i) => i.rule === "cyclomatic" && i.severity === "ERROR")).toBe(true);
    expect(err.ok).toBe(false);
  });

  it("flags deep nesting with the function name", () => {
    const src = `function deep(a) {
  if (a) {
    for (;;) {
      if (a) {
        while (a) {
          a -= 1;
        }
      }
    }
  }
  return a;
}`;
    const r = scanCode(src);
    const nest = r.issues.find((i) => i.rule === "nesting");
    expect(nest).toBeDefined();
    expect(nest!.message).toContain("`deep`");
    expect(nest!.severity).toBe("WARN"); // 4 levels inside the body
  });

  it("warns at 5 params and errors at 7", () => {
    const warn = scanCode(`function f(a, b, c, d, e) { return a; }`);
    expect(warn.issues.some((i) => i.rule === "params" && i.severity === "WARN")).toBe(true);
    const err = scanCode(`function g(a, b, c, d, e, f2, g2) { return a; }`);
    expect(err.issues.some((i) => i.rule === "params" && i.severity === "ERROR")).toBe(true);
  });

  it("flags magic numbers with their line, allowing 0/1/2/-1/100", () => {
    const src = `const x = arr[0] + 1;\nsetTimeout(cb, 5000);\nconst pct = n * 100;`;
    const r = scanCode(src);
    const magics = r.issues.filter((i) => i.rule === "magic-number");
    expect(magics.length).toBe(1);
    expect(magics[0].line).toBe(2);
    expect(magics[0].message).toContain("5000");
  });

  it("exempts SCREAMING_CASE constant declarations (that's the fix)", () => {
    const r = scanCode(`const MAX_RETRIES = 5;\nconst TIMEOUT_MS = 30000;`);
    expect(r.issues.filter((i) => i.rule === "magic-number").length).toBe(0);
  });

  it("does not count keywords inside strings or comments toward complexity", () => {
    const src = `function quiet() {\n  // if (a) { if (b) { if (c) {} } }\n  const s = "if if if if if if if if if if if if";\n  return s;\n}`;
    const r = scanCode(src);
    expect(r.issues.filter((i) => i.rule === "cyclomatic").length).toBe(0);
  });

  it("detects a duplicated block and points at the original", () => {
    const block = `  const user = getUser(input);\n  validate(user.name);\n  validate(user.email);\n  persist(user, options);`;
    const src = `function a() {\n${block}\n}\nfunction b() {\n${block}\n}`;
    const r = scanCode(src);
    const dup = r.issues.find((i) => i.rule === "duplicate");
    expect(dup).toBeDefined();
    expect(dup!.message).toMatch(/duplicate lines 2–5/);
  });
});

describe("scanCode — diff mode", () => {
  const DIFF = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,4 +10,6 @@
 function existing(a) {
+  const wait = 5000;
+  setTimeout(cb, wait);
   return a;
 }
`;

  it("detects unified diffs", () => {
    expect(looksLikeDiff(DIFF)).toBe(true);
    expect(looksLikeDiff("function f() {}")).toBe(false);
  });

  it("parses hunks with new-file line numbers and added-line marks", () => {
    const hunks = parseDiffHunks(DIFF);
    expect(hunks.length).toBe(1);
    expect(hunks[0].file).toBe("src/foo.ts");
    expect(hunks[0].fragment.split("\n").length).toBe(5);
    expect([...hunks[0].added]).toEqual([2, 3]);
    expect(hunks[0].map[1]).toBe(11); // first added line is new-file line 11
  });

  it("reports issues on added lines only, with new-file line numbers", () => {
    const r = scanCode(DIFF);
    expect(r.summary.mode).toBe("diff");
    const magic = r.issues.find((i) => i.rule === "magic-number");
    expect(magic).toBeDefined();
    expect(magic!.line).toBe(11); // 5000 sits on new-file line 11
    // nothing reported for the context-only function header
    expect(r.issues.every((i) => [11, 12].includes(i.line))).toBe(true);
  });

  it("ignores '\\ No newline at end of file' markers instead of ending the hunk", () => {
    const D = `--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,2 @@
 const keep = 1;
-const old = 9;
\\ No newline at end of file
+const fresh = 8888;
`;
    const r = scanCode(D);
    expect(r.issues.some((i) => i.rule === "magic-number" && i.message.includes("8888"))).toBe(true);
  });

  it("duplicate messages reference new-file line numbers in diff mode", () => {
    const block = `  const user = getUser(input);\n  validate(user.name);\n  validate(user.email);\n  persist(user, options);`;
    const body = `function a() {\n${block}\n}\nfunction b() {\n${block}\n}`;
    const plus = body
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");
    const D = `--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +100,12 @@\n${plus}\n`;
    const r = scanCode(D);
    const dup = r.issues.find((i) => i.rule === "duplicate");
    expect(dup).toBeDefined();
    expect(dup!.message).toMatch(/duplicate lines 101–104/);
  });
});

describe("detectForeignLanguage + language guard", () => {
  it("flags a Python paste with one honest WARN", () => {
    const py = `def total(orders):\n    s = 0\n    for o in orders:\n        s += o.price\n    return s`;
    expect(detectForeignLanguage(py)).toBe("Python");
    const r = scanCode(py);
    const lang = r.issues.filter((i) => i.rule === "language");
    expect(lang).toHaveLength(1);
    expect(lang[0].message).toMatch(/Python/);
  });

  it("does not flag normal TS", () => {
    expect(detectForeignLanguage(`const x = (a: number) => a + 1;`)).toBeNull();
  });

  it("does not flag TS `end` properties/assignments as Ruby", () => {
    // Everyday TS — this very lib has an `end: number;` field. Only a bare
    // `end` line (a Ruby block terminator) is a tell.
    expect(detectForeignLanguage(`type Span = {\n  start: number;\n  end: number;\n};`)).toBeNull();
    expect(detectForeignLanguage(`let end = 0;\nend = i + 1;`)).toBeNull();
    expect(detectForeignLanguage(`def total(orders)\n  orders.sum\nend`)).toBe("Ruby");
  });
});

describe("magic-number allowlist", () => {
  it("does not warn on HTTP status codes or round timeouts", () => {
    const code = `function h(res) {\n  res.status(404).send();\n  setTimeout(retry, 1000);\n}`;
    const r = scanCode(code);
    expect(r.issues.filter((i) => i.rule === "magic-number")).toHaveLength(0);
  });

  it("still warns on opaque business numbers", () => {
    const code = `function f(x) {\n  return x * 0.85;\n}`;
    const r = scanCode(code);
    expect(r.issues.some((i) => i.rule === "magic-number" && /0\.85/.test(i.message))).toBe(true);
  });
});
