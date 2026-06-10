// Dependency-free TS/JS code-smell scanner. Mirrors the gherkinLint/adrLint
// pattern: pure functions, ERROR = gate, WARN = advisory, every issue carries a
// line number. Heuristic by design (no AST) — strings and comments are stripped
// first so keywords inside them never count, and regex literals are consumed so
// their contents can't open a fake string/comment. Accepts either raw code or a
// unified diff (added lines are scanned, with new-file line numbers).
// Known limits (documented, accepted): generic functions `f<T>(…)` and commas
// inside generic type args may be missed/miscounted; object-literal braces count
// toward nesting depth.

export type SmellSeverity = "ERROR" | "WARN";
export type SmellIssue = { severity: SmellSeverity; line: number; rule: string; message: string };
export type SmellResult = {
  issues: SmellIssue[];
  summary: { errors: number; warnings: number; functions: number; lines: number; mode: "code" | "diff" };
  ok: boolean;
};

// Thresholds (decision points / brace depth inside a function body / params).
const CYCLO_WARN = 10;
const CYCLO_ERROR = 15;
const NEST_WARN = 4;
const NEST_ERROR = 6;
const PARAMS_WARN = 5;
const PARAMS_ERROR = 7;
const DUP_WINDOW = 4; // consecutive significant lines
// Numbers that read as self-explanatory in real code: tiny constants, percent
// base, HTTP status codes, and round powers of ten (ports/timeouts). The old
// set (0/1/2/-1/100) made every `res.status(404)` a WARN — pure noise.
const ALLOWED_NUMBERS = new Set([
  "0", "1", "2", "-1", "100",
  "200", "201", "204", "301", "302", "304", "400", "401", "403", "404", "409", "429", "500", "502", "503",
  "10", "1000", "10000", "60", "24", "365",
]);

// Cheap foreign-language tells. The lexer is TS/JS-only; a Python or C# paste
// used to run through it anyway and emit confident nonsense findings.
const FOREIGN_TELLS: { re: RegExp; lang: string }[] = [
  { re: /^\s*def \w+\(.*\)\s*(->.*)?:\s*$/m, lang: "Python" },
  { re: /^\s*#include\s*[<"]/m, lang: "C/C++" },
  { re: /\bpublic\s+(static\s+)?(void|class|final)\b/, lang: "Java/C#" },
  { re: /^\s*package\s+[\w.]+\s*$/m, lang: "Go" },
  { re: /^\s*fn\s+\w+\s*(<[^>]*>)?\(.*\)\s*(->|\{)/m, lang: "Rust" },
  { re: /^\s*elif\b/m, lang: "Python" },
  // Bare `end` on its own line only — `end: number;` / `end = i` are everyday
  // TS (this file has one) and used to mislabel a correct scan as Ruby.
  { re: /^\s*end\s*$/m, lang: "Ruby" },
];

/** Detect a paste that's clearly not TS/JS. Returns the language name or null. */
export function detectForeignLanguage(code: string): string | null {
  for (const t of FOREIGN_TELLS) if (t.re.test(code)) return t.lang;
  return null;
}

const NOT_A_METHOD = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "else", "do",
  "new", "in", "of", "case", "await", "yield", "delete", "void", "throw", "function",
]);

/**
 * Is a `/` at index i the start of a regex literal (vs division)? Division
 * needs a LEFT OPERAND — an identifier, number, `)` or `]` — so anything else
 * (including a statement start right after a comment line) begins a regex.
 * Keyword operands (`return /…/`) are re-classified by the tail check.
 */
function canStartRegex(src: string, i: number, lastSig: string): boolean {
  if (!/[\w$)\]]/.test(lastSig)) return true;
  return /\b(return|case|typeof|in|of|do|else)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd());
}

/**
 * Replace the contents of strings, template literals, comments, and regex
 * literals with spaces, preserving newlines and overall length so every line
 * number in the stripped text matches the original. Template `${…}` expressions
 * stay visible (they are code); their delimiters are blanked so brace counts
 * stay balanced.
 */
export function stripCode(src: string): string {
  const out = src.split("");
  type State = "code" | "line" | "block" | "single" | "double" | "template" | "regex" | "regexClass";
  let state: State = "code";
  // Each entry = one template-literal level; the value = `{` depth inside its
  // current ${…} expression (-1 when we're in the literal text, not an expr).
  const tpl: number[] = [];
  let lastSig = "";

  const blank = (i: number) => {
    if (out[i] !== "\n") out[i] = " ";
  };
  const blankEscape = (i: number): number => {
    blank(i);
    if (src[i + 1] !== undefined && src[i + 1] !== "\n") {
      blank(i + 1);
      return i + 1;
    }
    return i;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        blank(i);
      } else if (c === "/" && next === "*") {
        state = "block";
        blank(i);
      } else if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") {
        tpl.push(-1);
        state = "template";
        blank(i);
      } else if (c === "/" && canStartRegex(src, i, lastSig)) {
        state = "regex";
        blank(i);
      } else if (tpl.length > 0 && tpl[tpl.length - 1] >= 0) {
        // inside a ${…} expression of a template literal
        if (c === "{") tpl[tpl.length - 1]++;
        else if (c === "}") {
          if (tpl[tpl.length - 1] === 0) {
            tpl[tpl.length - 1] = -1; // expression closed → back to literal text
            state = "template";
            blank(i);
          } else tpl[tpl.length - 1]--;
        }
      }
      if (!/\s/.test(c)) lastSig = c;
      continue;
    }

    switch (state) {
      case "line":
        if (c === "\n") state = "code";
        else blank(i);
        break;
      case "block":
        if (c === "*" && next === "/") {
          blank(i);
          blank(i + 1);
          i++;
          state = "code";
        } else blank(i);
        break;
      case "single":
        if (c === "\\") i = blankEscape(i);
        else if (c === "'" || c === "\n") state = "code";
        else blank(i);
        break;
      case "double":
        if (c === "\\") i = blankEscape(i);
        else if (c === '"' || c === "\n") state = "code";
        else blank(i);
        break;
      case "template":
        if (c === "\\") i = blankEscape(i);
        else if (c === "`") {
          tpl.pop();
          state = "code";
          blank(i);
        } else if (c === "$" && next === "{") {
          blank(i);
          blank(i + 1);
          i++;
          tpl[tpl.length - 1] = 0;
          state = "code";
        } else blank(i);
        break;
      case "regex":
        if (c === "\\") i = blankEscape(i);
        else if (c === "[") {
          state = "regexClass";
          blank(i);
        } else if (c === "/") {
          state = "code";
          lastSig = "/";
          blank(i);
        } else if (c === "\n") state = "code";
        else blank(i);
        break;
      case "regexClass":
        if (c === "\\") i = blankEscape(i);
        else if (c === "]") {
          state = "regex";
          blank(i);
        } else if (c === "\n") state = "code";
        else blank(i);
        break;
    }
  }
  return out.join("");
}

type FnSpan = {
  name: string;
  headerLine: number;
  start: number; // index of opening brace
  end: number; // index of matching closing brace
  params: number;
};

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

function matchFrom(src: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Walk back from a `)` to its matching `(`. */
function parenStart(src: string, closeParen: number): number {
  let depth = 0;
  for (let i = closeParen; i >= 0; i--) {
    if (src[i] === ")") depth++;
    else if (src[i] === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function countParams(paramSrc: string): number {
  const trimmed = paramSrc.trim();
  if (!trimmed) return 0;
  let depth = 0;
  let count = 1;
  for (const c of trimmed) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) count++;
  }
  return count;
}

/** A TS return-type annotation between `)` and `{` (e.g. `: Promise<void>`). */
function isReturnType(s: string): boolean {
  const t = s.trim();
  return t === "" || /^:\s*[\w<>[\]., |&'"`?:]+$/.test(t);
}

/** Find function units: declarations, methods, and arrow functions with block bodies. */
export function findFunctions(stripped: string): FnSpan[] {
  const spans: FnSpan[] = [];
  const seen = new Set<number>();

  const add = (name: string, headerIdx: number, openBrace: number, paramSrc: string) => {
    if (openBrace < 0 || seen.has(openBrace)) return;
    const end = matchFrom(stripped, openBrace, "{", "}");
    if (end < 0) return;
    seen.add(openBrace);
    spans.push({
      name: name || "(anonymous)",
      headerLine: lineOf(stripped, headerIdx),
      start: openBrace,
      end,
      params: countParams(paramSrc),
    });
  };

  // `function name(…) {` / `function (…) {`
  const FN = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = FN.exec(stripped))) {
    const openParen = FN.lastIndex - 1;
    const closeParen = matchFrom(stripped, openParen, "(", ")");
    if (closeParen < 0) continue;
    const brace = stripped.indexOf("{", closeParen);
    if (brace < 0 || !isReturnType(stripped.slice(closeParen + 1, brace))) continue;
    add(m[1] ?? "", m.index, brace, stripped.slice(openParen + 1, closeParen));
  }

  // Arrow functions with block bodies: `… => {`
  const ARROW = /=>\s*{/g;
  while ((m = ARROW.exec(stripped))) {
    const brace = stripped.indexOf("{", m.index);
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(stripped[j])) j--;
    let paramSrc = "";
    let headerIdx: number;
    if (stripped[j] === ")") {
      const open = parenStart(stripped, j);
      if (open < 0) continue;
      paramSrc = stripped.slice(open + 1, j);
      headerIdx = open;
    } else {
      let k = j;
      while (k >= 0 && /[\w$]/.test(stripped[k])) k--;
      paramSrc = stripped.slice(k + 1, j + 1);
      headerIdx = k + 1;
      if (!paramSrc.trim()) continue;
    }
    const before = stripped.slice(Math.max(0, headerIdx - 80), headerIdx);
    const nameMatch = /([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?$/.exec(before);
    add(nameMatch?.[1] ?? "", headerIdx, brace, paramSrc);
  }

  // Class/object methods: `name(…) {` not preceded by a keyword (i.e. not `if (…) {`).
  const METHOD = /(^|[\n{};])\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = METHOD.exec(stripped))) {
    const name = m[2];
    if (NOT_A_METHOD.has(name)) continue;
    const openParen = METHOD.lastIndex - 1;
    const closeParen = matchFrom(stripped, openParen, "(", ")");
    if (closeParen < 0) continue;
    const brace = stripped.indexOf("{", closeParen);
    if (brace < 0 || !isReturnType(stripped.slice(closeParen + 1, brace))) continue;
    add(name, m.index + m[1].length, brace, stripped.slice(openParen + 1, closeParen));
  }

  return spans.sort((a, b) => a.start - b.start);
}

/** Body text of a span with directly-nested function spans blanked out. */
export function ownBody(stripped: string, span: FnSpan, all: FnSpan[]): string {
  let body = stripped.slice(span.start, span.end + 1);
  for (const other of all) {
    if (other === span || other.start <= span.start || other.end >= span.end) continue;
    const from = other.start - span.start;
    const to = other.end - span.start + 1;
    body = body.slice(0, from) + body.slice(from, to).replace(/[^\n]/g, " ") + body.slice(to);
  }
  return body;
}

export function countDecisions(body: string): number {
  const keywords = (body.match(/\b(if|for|while|case|catch)\b/g) ?? []).length;
  const logical = (body.match(/&&|\|\||\?\?/g) ?? []).length;
  const nullish = (body.match(/\?\?/g) ?? []).length;
  // `?` that isn't optional chaining (?.), nullish (??), or a TS optional (?:).
  const ternary = Math.max(0, (body.match(/\?(?![.?:])/g) ?? []).length - nullish);
  return keywords + logical + ternary;
}

function maxNesting(body: string): { depth: number; line: number } {
  let depth = 0;
  let max = 0;
  let line = 1;
  let maxLine = 1;
  for (const c of body) {
    if (c === "\n") line++;
    else if (c === "{") {
      depth++;
      if (depth > max) {
        max = depth;
        maxLine = line;
      }
    } else if (c === "}") depth--;
  }
  return { depth: Math.max(0, max - 1), line: maxLine }; // -1: the body's own brace
}

/**
 * Scan one code fragment. `lineMap` decides whether an issue is reported and at
 * what line (diff hunks drop non-added lines); `displayLine` maps line numbers
 * EMBEDDED IN MESSAGE TEXT (e.g. "duplicates lines X–Y"), which must always map
 * even when those lines are unreported context.
 */
function scanFragment(
  code: string,
  issues: SmellIssue[],
  lineMap?: (l: number) => number | null,
  displayLine?: (l: number) => number
): number {
  const stripped = stripCode(code);
  const show = (l: number) => (displayLine ? displayLine(l) : l);
  const push = (severity: SmellSeverity, line: number, rule: string, message: string) => {
    const mapped = lineMap ? lineMap(line) : line;
    if (mapped !== null) issues.push({ severity, line: mapped, rule, message });
  };

  const fns = findFunctions(stripped);
  for (const fn of fns) {
    const body = ownBody(stripped, fn, fns);
    const cyclo = 1 + countDecisions(body);
    if (cyclo > CYCLO_ERROR) {
      push("ERROR", fn.headerLine, "cyclomatic", `\`${fn.name}\` has cyclomatic complexity ~${cyclo} (gate: ${CYCLO_ERROR}) — split it into smaller functions.`);
    } else if (cyclo > CYCLO_WARN) {
      push("WARN", fn.headerLine, "cyclomatic", `\`${fn.name}\` has cyclomatic complexity ~${cyclo} (advisory threshold: ${CYCLO_WARN}).`);
    }

    const nest = maxNesting(body);
    const nestLine = lineOf(stripped, fn.start) + nest.line - 1;
    if (nest.depth >= NEST_ERROR) {
      push("ERROR", nestLine, "nesting", `\`${fn.name}\` nests ${nest.depth} levels deep — flatten with early returns or extracted helpers.`);
    } else if (nest.depth >= NEST_WARN) {
      push("WARN", nestLine, "nesting", `\`${fn.name}\` nests ${nest.depth} levels deep.`);
    }

    if (fn.params >= PARAMS_ERROR) {
      push("ERROR", fn.headerLine, "params", `\`${fn.name}\` takes ${fn.params} parameters — pass an options object instead.`);
    } else if (fn.params >= PARAMS_WARN) {
      push("WARN", fn.headerLine, "params", `\`${fn.name}\` takes ${fn.params} parameters.`);
    }
  }

  // Magic numbers (strings/comments already stripped; named constants exempt —
  // a `const LIMIT = 25` declaration is the fix, not the smell).
  const strippedLines = stripped.split("\n");
  strippedLines.forEach((l, idx) => {
    if (/^\s*(export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=/.test(l)) return;
    const nums = (l.match(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.:])/g) ?? []).filter((n) => !ALLOWED_NUMBERS.has(n));
    if (nums.length) {
      const uniq = [...new Set(nums)];
      push("WARN", idx + 1, "magic-number", `Magic number${uniq.length > 1 ? "s" : ""} ${uniq.join(", ")} — name ${uniq.length > 1 ? "them" : "it"} with a const.`);
    }
  });

  // Duplicate windows of significant lines.
  const sig: { line: number; text: string }[] = [];
  strippedLines.forEach((l, idx) => {
    const t = l.trim().replace(/\s+/g, " ");
    if (t.length >= 8 && !/^[{}();,]*$/.test(t)) sig.push({ line: idx + 1, text: t });
  });
  const windows = new Map<string, number[]>();
  for (let i = 0; i + DUP_WINDOW <= sig.length; i++) {
    const key = sig.slice(i, i + DUP_WINDOW).map((s) => s.text).join(" ");
    const arr = windows.get(key) ?? [];
    arr.push(i);
    windows.set(key, arr);
  }
  const reported: number[] = [];
  // Filter BEFORE sorting: single-occurrence windows have no [1] and would feed
  // NaN to the comparator, scrambling the order the overlap suppression assumes.
  const dupWindows = [...windows.values()].filter((o) => o.length >= 2).sort((a, b) => a[1] - b[1]);
  for (const occurrences of dupWindows) {
    const copy = occurrences[1];
    if (reported.some((s) => Math.abs(s - copy) < DUP_WINDOW)) continue; // overlapping run
    reported.push(copy);
    push(
      "WARN",
      sig[copy].line,
      "duplicate",
      `${DUP_WINDOW} similar lines duplicate lines ${show(sig[occurrences[0]].line)}–${show(sig[occurrences[0] + DUP_WINDOW - 1].line)} — extract a helper.`
    );
  }

  return fns.length;
}

// ── Unified diff support ──────────────────────────────────────────────────────

export function looksLikeDiff(text: string): boolean {
  return /^diff --git /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ -\d/m.test(text));
}

export type DiffHunk = { file: string; fragment: string; map: (number | null)[]; added: Set<number> };

/** Reconstruct the new-file side of each hunk with a fragment-line → new-file-line map. */
export function parseDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let file = "";
  let cur: { lines: string[]; map: (number | null)[]; added: Set<number>; newLine: number } | null = null;

  const flush = () => {
    if (cur && cur.lines.length) {
      hunks.push({ file, fragment: cur.lines.join("\n"), map: cur.map, added: cur.added });
    }
    cur = null;
  };

  const rows = diff.split(/\r?\n/);
  if (rows[rows.length - 1] === "") rows.pop(); // trailing-newline artifact, not a context line

  for (const raw of rows) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "").trim();
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      flush();
      cur = { lines: [], map: [], added: new Set(), newLine: parseInt(h[1], 10) };
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("+")) {
      cur.lines.push(raw.slice(1));
      cur.map.push(cur.newLine);
      cur.added.add(cur.lines.length); // 1-based fragment line
      cur.newLine++;
    } else if (raw.startsWith(" ") || raw === "") {
      cur.lines.push(raw.slice(1));
      cur.map.push(cur.newLine);
      cur.newLine++;
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — metadata about the PREVIOUS line, not
      // content; flushing here would silently drop the rest of the hunk.
    } else if (!raw.startsWith("-")) {
      flush(); // `diff --git`, index/mode lines, …
    }
  }
  flush();
  return hunks;
}

/** Scan raw TS/JS code or a unified diff (added lines only, new-file line numbers). */
export function scanCode(input: string): SmellResult {
  const issues: SmellIssue[] = [];
  let functions = 0;
  const isDiff = looksLikeDiff(input);

  // A clearly-foreign paste gets one honest WARN up front instead of letting
  // the TS/JS lexer emit confident nonsense below it.
  const foreign = detectForeignLanguage(input);
  if (foreign) {
    issues.push({
      severity: "WARN",
      line: 1,
      rule: "language",
      message: `This looks like ${foreign} — the scanner only understands TS/JS, so findings below may be wrong.`,
    });
  }

  if (isDiff) {
    const hunks = parseDiffHunks(input);
    const files = new Set(hunks.map((h) => h.file).filter(Boolean));
    for (const hunk of hunks) {
      const before = issues.length;
      functions += scanFragment(
        hunk.fragment,
        issues,
        (l) => {
          if (!hunk.added.has(l)) return null; // only review the change itself
          return hunk.map[l - 1] ?? l;
        },
        (l) => hunk.map[l - 1] ?? l
      );
      if (files.size > 1 && hunk.file) {
        for (let i = before; i < issues.length; i++) {
          issues[i] = { ...issues[i], message: `${issues[i].message} (in ${hunk.file})` };
        }
      }
    }
  } else {
    functions = scanFragment(input, issues);
  }

  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARN").length;
  issues.sort((a, b) => a.line - b.line || (a.severity === b.severity ? 0 : a.severity === "ERROR" ? -1 : 1));

  return {
    issues,
    summary: {
      errors,
      warnings,
      functions,
      lines: input.split(/\r?\n/).length,
      mode: isDiff ? "diff" : "code",
    },
    ok: errors === 0,
  };
}
