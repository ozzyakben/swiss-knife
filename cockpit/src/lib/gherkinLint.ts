// Dependency-free Gherkin linter for BDD hygiene. A TypeScript port of the LBMH
// Gherkin lint rules (one event per scenario, business-level language, standard
// tags, the {Type} [name] entity convention). Pure functions — usable in a route
// or a test. ERRORs are gates (block); WARNs are advisory.

export type GherkinSeverity = "ERROR" | "WARN";
export type GherkinIssue = { severity: GherkinSeverity; line: number; message: string };
export type GherkinLintResult = {
  issues: GherkinIssue[];
  summary: { errors: number; warnings: number; scenarios: number };
  ok: boolean;
};

const APPROVED_TAGS = new Set([
  "valid", "invalid", "regression", "security", // intent
  "api", "ui", "smoke", "critical", // type/scope
  "dev", "prod", // environment
  "wip", "deprecated", "flaky", // stability
  "fast", "slow", // duration
]);
const INTENT_TAGS = new Set(["valid", "invalid", "regression", "security"]);
const SUITE_TAGS = new Set(["smoke", "regression"]);

const LEAK_PATTERNS: { re: RegExp; msg: string }[] = [
  { re: /\bclick(s|ed)?\b\s+(the\s+)?(button|link|menu|icon|tab|field)\b/i,
    msg: "UI interaction detail (describe behaviour/outcome, not clicks)" },
  { re: /#[0-9a-fA-F]{3,6}\b|\bcss\b|xpath|#[A-Za-z][\w-]*\s*$|\bselector\b/i,
    msg: "UI selector / CSS / XPath leakage" },
  { re: /\b\w+\.\w+\([^)]*\)/,
    msg: "code call / method invocation in step (keep business-level)" },
  { re: /\bfeature[ _-]?flag\b|\btoggle\b/i,
    msg: "feature-flag leakage" },
  { re: /\b(SELECT|INSERT|UPDATE|DELETE)\b\s/i,
    msg: "raw SQL in step" },
  { re: /\bnavigates? to\b|\bURL\b|https?:\/\//i,
    msg: "navigation/URL detail (keep business-level)" },
];

const STEP_KW = /^\s*(Given|When|Then|And|But|\*)\s+(.*)$/;
const ENTITY_DECL = /\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*)\s+\[([^[\]]+)\]/g;
const ENTITY_REF = /\[([^[\]]+)\]/g;

type Step = { line: number; kw: string; text: string };
type Scenario = { name: string; line: number; tags: string[]; steps: Step[]; whens: number };
type Feature = {
  hasFeature: boolean;
  hasDescription: boolean;
  scenarios: Scenario[];
  backgroundGivens: string[];
};

function parseFeature(text: string): Feature {
  const lines = text.split(/\r?\n/);
  const feature: Feature = {
    hasFeature: false,
    hasDescription: false,
    scenarios: [],
    backgroundGivens: [],
  };
  let cur: Scenario | null = null;
  let pendingTags: string[] = [];
  let inBackground = false;

  lines.forEach((raw, idx) => {
    const i = idx + 1;
    const line = raw.trim();
    if (!line) return;

    if (line.startsWith("@")) {
      pendingTags = line.split(/\s+/).map((t) => t.replace(/^@/, ""));
      return;
    }
    if (/^Feature:/.test(line)) {
      feature.hasFeature = true;
      pendingTags = [];
      return;
    }
    if (/^Background:/.test(line)) {
      inBackground = true;
      cur = null;
      return;
    }
    const mScen = /^(Scenario(?: Outline| Template)?|Example):\s*(.*)$/.exec(line);
    if (mScen) {
      inBackground = false;
      cur = { name: mScen[2], line: i, tags: pendingTags, steps: [], whens: 0 };
      feature.scenarios.push(cur);
      pendingTags = [];
      return;
    }
    const mStep = STEP_KW.exec(raw);
    if (mStep) {
      const kw = mStep[1];
      const stepText = mStep[2].trim();
      if (inBackground) feature.backgroundGivens.push(stepText);
      else if (cur) {
        cur.steps.push({ line: i, kw, text: stepText });
        if (kw === "When") cur.whens += 1;
      }
      return;
    }
    // Free text under Feature, before any scenario/background → the description.
    if (feature.hasFeature && feature.scenarios.length === 0 && !inBackground) {
      feature.hasDescription = true;
    }
  });

  return feature;
}

export function lintGherkin(text: string): GherkinLintResult {
  const feature = parseFeature(text);
  const issues: GherkinIssue[] = [];

  if (!feature.hasFeature) {
    issues.push({ severity: "ERROR", line: 1, message: "No `Feature:` declaration found." });
  }
  if (!feature.hasDescription) {
    issues.push({ severity: "WARN", line: 1, message: "Feature has no free-text description (business value/context)." });
  }

  // Givens duplicated across scenarios → should live in Background.
  const givenCounts = new Map<string, number>();
  for (const s of feature.scenarios) {
    const seen = new Set<string>();
    for (const st of s.steps) {
      if ((st.kw === "Given" || st.kw === "And") && !seen.has(st.text)) {
        givenCounts.set(st.text, (givenCounts.get(st.text) ?? 0) + 1);
        seen.add(st.text);
      }
    }
  }
  const dupGivens =
    feature.scenarios.length >= 2
      ? [...givenCounts.entries()].filter(([, c]) => c >= 2).map(([g]) => g)
      : [];

  // Entities introduced in Background count as declared everywhere.
  const declared = new Set<string>(feature.backgroundGivens);
  for (const m of feature.backgroundGivens.join(" ").matchAll(ENTITY_DECL)) declared.add(m[2]);

  for (const s of feature.scenarios) {
    const tagset = new Set(s.tags);
    if (tagset.size === 0) {
      issues.push({ severity: "ERROR", line: s.line, message: `Scenario '${s.name}' has no tags.` });
    } else {
      const unknown = [...tagset].filter((t) => !APPROVED_TAGS.has(t)).sort();
      if (unknown.length) {
        issues.push({
          severity: "WARN",
          line: s.line,
          message: `Scenario '${s.name}' uses non-standard tag(s): ${unknown.map((t) => "@" + t).join(", ")}.`,
        });
      }
      if (![...tagset].some((t) => INTENT_TAGS.has(t))) {
        issues.push({
          severity: "ERROR",
          line: s.line,
          message: `Scenario '${s.name}' missing an intent tag (@valid/@invalid/@regression/@security).`,
        });
      }
      if (![...tagset].some((t) => SUITE_TAGS.has(t))) {
        issues.push({
          severity: "WARN",
          line: s.line,
          message: `Scenario '${s.name}' missing a suite tag (@smoke/@regression).`,
        });
      }
    }

    if (s.whens === 0) {
      issues.push({ severity: "WARN", line: s.line, message: `Scenario '${s.name}' has no \`When\` (no event).` });
    } else if (s.whens > 1) {
      issues.push({
        severity: "ERROR",
        line: s.line,
        message: `Scenario '${s.name}' has ${s.whens} \`When\` steps — exactly one event per scenario.`,
      });
    }

    const localDeclared = new Set(declared);
    for (const st of s.steps) {
      for (const { re, msg } of LEAK_PATTERNS) {
        if (re.test(st.text)) {
          issues.push({ severity: "WARN", line: st.line, message: `Possible implementation leakage — ${msg}: "${st.text}"` });
          break;
        }
      }
      for (const m of st.text.matchAll(ENTITY_DECL)) localDeclared.add(m[2]);
      for (const m of st.text.matchAll(ENTITY_REF)) {
        const name = m[1];
        if (!localDeclared.has(name)) {
          issues.push({
            severity: "WARN",
            line: st.line,
            message: `Entity [${name}] referenced before a typed first-use (\`Type [${name}]\`): "${st.text}"`,
          });
          localDeclared.add(name); // report once
        }
      }
    }
  }

  if (feature.scenarios.length) {
    for (const g of dupGivens) {
      issues.push({
        severity: "WARN",
        line: feature.scenarios[0].line,
        message: `Given duplicated across scenarios — move to Background: "${g}"`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARN").length;
  issues.sort((a, b) => a.line - b.line || (a.severity === b.severity ? 0 : a.severity === "ERROR" ? -1 : 1));

  return { issues, summary: { errors, warnings, scenarios: feature.scenarios.length }, ok: errors === 0 };
}

// ── Coverage analysis ────────────────────────────────────────────────────────
// Deterministic "what's not covered" read of a .feature, distinct from the
// pass/fail lint: it surfaces missing test dimensions (negative paths, missing
// assertions) so a happy-path-only draft is visible at a glance.
export type Coverage = {
  scenarios: number;
  intents: { valid: number; invalid: number; security: number; regression: number };
  noAssertion: number;
  gaps: string[];
};

export function analyzeCoverage(text: string): Coverage {
  const feature = parseFeature(text);
  const intents = { valid: 0, invalid: 0, security: 0, regression: 0 };
  let noAssertion = 0;
  for (const s of feature.scenarios) {
    const tags = new Set(s.tags);
    if (tags.has("valid")) intents.valid += 1;
    if (tags.has("invalid")) intents.invalid += 1;
    if (tags.has("security")) intents.security += 1;
    if (tags.has("regression")) intents.regression += 1;
    if (!s.steps.some((st) => st.kw === "Then")) noAssertion += 1;
  }
  const gaps: string[] = [];
  if (feature.scenarios.length > 0 && intents.invalid === 0 && intents.security === 0) {
    gaps.push("No negative paths — every scenario is a happy path. Add @invalid / @security cases.");
  }
  if (noAssertion > 0) {
    gaps.push(`${noAssertion} scenario${noAssertion > 1 ? "s" : ""} with no \`Then\` (no assertion).`);
  }
  return { scenarios: feature.scenarios.length, intents, noAssertion, gaps };
}
