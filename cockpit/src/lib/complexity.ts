// Complexity Analyzer primitives. The MODEL estimates Big-O (it can reason
// about algorithms); the STATIC SCAN here establishes what growth mechanisms
// the code actually contains — loop nesting, recursion, sorting — and audits
// the model's claim against them. A static scan can't prove Big-O, but it can
// prove the ABSENCE of mechanisms: a claim of O(n²) over code with no loops,
// no recursion, and no sort is a hallucination worth flagging. Reuses the
// codeSmells lexer (strings/comments stripped, functions located).

import {
  findFunctions,
  ownBody,
  parseDiffHunks,
  stripCode,
  type SmellIssue,
  type SmellResult,
} from "@/lib/codeSmells";

export type FnComplexity = {
  name: string;
  line: number;
  loopDepth: number; // max nesting of loops/iteration callbacks within the function
  recursive: boolean;
  callsSort: boolean;
};

export type ComplexityScan = {
  functions: FnComplexity[];
  maxLoopDepth: number;
  hasRecursion: boolean;
  hasSort: boolean;
  lines: number;
};

export type GrowthClass =
  | "constant"
  | "logarithmic"
  | "linear"
  | "linearithmic"
  | "polynomial"
  | "exponential"
  | "unknown";

export type ClaimIssue = { severity: "WARN"; message: string };

const LOOP_KEYWORD = /\b(for|while)\s*\(|\bdo\s*\{/g;
const ITERATION_METHOD = /\.(map|forEach|filter|reduce|reduceRight|flatMap|some|every|find|findIndex)\s*\(/g;
const SORT_CALL = /\.(sort|toSorted)\s*\(/;

/** Max overlapping-loop nesting in a (stripped) function body. */
export function maxLoopNesting(body: string): number {
  // Keyword loops are "active" until brace depth returns to their entry depth.
  // Iteration callbacks close at their CALL's closing paren instead — a
  // braceless arrow body (`xs.map(x => x * 2)`) never emits a `}`, and keying
  // on braces alone made sequential callbacks look nested.
  const starts = new Map<number, "loop" | "iter">();
  let m: RegExpExecArray | null;
  LOOP_KEYWORD.lastIndex = 0;
  while ((m = LOOP_KEYWORD.exec(body))) starts.set(m.index, "loop");
  ITERATION_METHOD.lastIndex = 0;
  while ((m = ITERATION_METHOD.exec(body))) starts.set(m.index, "iter");

  let braceDepth = 0;
  let parenDepth = 0;
  let max = 0;
  const stack: { brace: number; paren: number; iter: boolean }[] = [];
  for (let i = 0; i < body.length; i++) {
    const kind = starts.get(i);
    if (kind) {
      stack.push({ brace: braceDepth, paren: parenDepth, iter: kind === "iter" });
      if (stack.length > max) max = stack.length;
    }
    const c = body[i];
    if (c === "(") parenDepth++;
    else if (c === ")") {
      parenDepth--;
      while (stack.length && stack[stack.length - 1].iter && parenDepth <= stack[stack.length - 1].paren) {
        stack.pop();
      }
    } else if (c === "{") braceDepth++;
    else if (c === "}") {
      braceDepth--;
      while (stack.length && stack[stack.length - 1].brace >= braceDepth) stack.pop();
    }
  }
  return max;
}

/** Deterministic growth-mechanism scan over a snippet. */
export function scanComplexity(code: string): ComplexityScan {
  const stripped = stripCode(code);
  const fns = findFunctions(stripped);

  const functions: FnComplexity[] = fns.map((fn) => {
    const body = ownBody(stripped, fn, fns);
    const recursive =
      fn.name !== "(anonymous)" && new RegExp(`\\b${escapeRe(fn.name)}\\s*\\(`).test(body.slice(1));
    return {
      name: fn.name,
      line: fn.headerLine,
      loopDepth: maxLoopNesting(body),
      recursive,
      callsSort: SORT_CALL.test(body),
    };
  });

  // Top-level code outside functions still counts (a bare nested loop snippet).
  const wholeDepth = maxLoopNesting(stripped);

  const maxLoopDepth = Math.max(wholeDepth, ...functions.map((f) => f.loopDepth), 0);
  return {
    functions,
    maxLoopDepth,
    hasRecursion: functions.some((f) => f.recursive),
    hasSort: SORT_CALL.test(stripped),
    lines: code.split(/\r?\n/).length,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Growth WARNs for one scanned region; `mapLine` translates fragment lines
 * (diff hunks) to new-file lines. */
function collectGrowthWarnings(
  scan: ComplexityScan,
  mapLine: (line: number) => number,
  out: SmellIssue[]
): void {
  let flaggedFn = false;
  for (const fn of scan.functions) {
    if (fn.loopDepth >= 3) {
      flaggedFn = true;
      out.push({
        severity: "WARN",
        line: mapLine(fn.line),
        rule: "growth",
        message: `\`${fn.name}\` nests iteration ${fn.loopDepth} deep — likely O(n^${fn.loopDepth}) growth. Confirm with the Big-O estimate.`,
      });
    }
  }
  if (!flaggedFn && scan.maxLoopDepth >= 3) {
    out.push({
      severity: "WARN",
      line: mapLine(1),
      rule: "growth",
      message: `Iteration nests ${scan.maxLoopDepth} deep — likely O(n^${scan.maxLoopDepth}) growth. Confirm with the Big-O estimate.`,
    });
  }
}

/**
 * Append free growth-mechanism WARNs to a smell-scan result: deep nested
 * iteration is an algorithmic smell the style rules don't see — the nesting
 * rule fires on braces, not on "this is probably O(n³)". Works on raw code
 * AND unified diffs (per reconstructed hunk, reported at new-file lines —
 * diffs are this tool's primary daily input). Zero model calls; lives here
 * (not codeSmells) because complexity already imports the codeSmells lexer
 * and the reverse import would be a cycle.
 */
export function withGrowthWarnings(result: SmellResult, code: string): SmellResult {
  const issues = [...result.issues];
  try {
    if (result.summary.mode === "code") {
      collectGrowthWarnings(scanComplexity(code), (l) => l, issues);
    } else {
      for (const hunk of parseDiffHunks(code)) {
        if (hunk.added.size === 0) continue; // pure deletions can't add growth
        // The diff must INTRODUCE iteration somewhere: a one-line edit inside
        // an existing 3-deep loop arrives with the loops as context lines, and
        // warning on those blames growth the change didn't add.
        const fragmentLines = hunk.fragment.split("\n");
        const addsIteration = [...hunk.added].some((l) => {
          const line = fragmentLines[l - 1] ?? "";
          LOOP_KEYWORD.lastIndex = 0;
          ITERATION_METHOD.lastIndex = 0;
          return LOOP_KEYWORD.test(line) || ITERATION_METHOD.test(line);
        });
        if (!addsIteration) continue;
        collectGrowthWarnings(
          scanComplexity(hunk.fragment),
          (l) => hunk.map[l - 1] ?? l,
          issues
        );
      }
    }
  } catch {
    return result; // advisory only — never break the scan
  }
  if (issues.length === result.issues.length) return result;
  issues.sort((a, b) => a.line - b.line || (a.severity === b.severity ? 0 : a.severity === "ERROR" ? -1 : 1));
  return {
    issues,
    summary: { ...result.summary, warnings: issues.filter((i) => i.severity === "WARN").length },
    ok: result.ok,
  };
}

/** Parse a Big-O string ("O(n log n)", "O(n²)", "O(n*m)") into a growth class. */
export function classifyBigO(s: string): GrowthClass {
  const inner = /o\(([^)]*)\)/i.exec(s.replace(/\s+/g, ""));
  if (!inner) return "unknown";
  const t = inner[1]
    .toLowerCase()
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/[×·]/g, "*");

  if (/!|\d+\^[a-z]|[a-z]\^[a-z]/.test(t)) return "exponential"; // n!, 2^n, k^n
  // n^2, n*n, n*m — but NOT n*log… (starred linearithmic falls through below).
  if (/[a-z]\^\d|([a-z])\*\1|[a-z]\*(?!log)[a-z]/.test(t)) return "polynomial";
  if (/[a-z]\*?log/.test(t)) return "linearithmic"; // nlogn, n*logn
  if (/^log/.test(t)) return "logarithmic";
  if (/^[a-z](\+[a-z])*$/.test(t)) return "linear"; // n, n+m, v+e
  if (/^(1|c)$/.test(t)) return "constant";
  return "unknown";
}

const RANK: Record<GrowthClass, number> = {
  constant: 0,
  logarithmic: 1,
  linear: 2,
  linearithmic: 3,
  polynomial: 4,
  exponential: 5,
  unknown: -1,
};

/**
 * Audit the model's time claim against the scanned mechanisms. WARNs only —
 * the scan can't prove a bound, but it can flag claims the code's structure
 * cannot justify (and suspicious under-claims).
 */
export function auditClaim(scan: ComplexityScan, timeBigO: string): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  const cls = classifyBigO(timeBigO);

  if (cls === "unknown") {
    issues.push({ severity: "WARN", message: `Couldn't parse the claimed bound "${timeBigO}" — expected O(...) notation.` });
    return issues;
  }

  // What can the visible mechanisms justify, at most?
  const cap = scan.hasRecursion
    ? RANK.exponential // recursion can be anything; trust the model
    : scan.maxLoopDepth >= 2
      ? RANK.polynomial
      : scan.maxLoopDepth === 1 || scan.hasSort
        ? RANK.linearithmic
        : RANK.constant;

  if (RANK[cls] > cap) {
    const found =
      scan.maxLoopDepth === 0 && !scan.hasRecursion && !scan.hasSort
        ? "no loops, no recursion, and no sort calls"
        : `max loop depth ${scan.maxLoopDepth}${scan.hasSort ? " plus sorting" : ""} and no recursion`;
    issues.push({
      severity: "WARN",
      message: `Claimed ${timeBigO}, but the static scan found ${found} — nothing in the code's structure justifies that growth. (A static scan can't prove Big-O; treat the claim as unverified.)`,
    });
  }

  if (RANK[cls] <= RANK.logarithmic && scan.maxLoopDepth >= 2) {
    issues.push({
      severity: "WARN",
      message: `Claimed ${timeBigO}, but the scan found loops nested ${scan.maxLoopDepth} deep — that bound looks optimistic unless the loops are constant-bounded.`,
    });
  }

  return issues;
}
