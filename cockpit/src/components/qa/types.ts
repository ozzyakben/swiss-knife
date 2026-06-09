// Client-side DTO shapes for the QA pipeline (mirrors lib/qaPipeline serializers).
// Defined here, not imported from the server module, so the client bundle never
// pulls in prisma.

export type LintIssue = { severity: "ERROR" | "WARN"; line: number; message: string };

export type Lint = {
  issues: LintIssue[];
  summary: { errors: number; warnings: number; scenarios: number };
  ok: boolean;
};

export type Verdict = "PASS" | "BLOCK" | "UNKNOWN";
export type Rubric = { raw: string; verdict: Verdict; score?: number | null } | null;

export type Iteration = {
  id: string;
  order: number;
  instruction: string | null;
  draftFeature: string;
  lint: Lint;
  rubric: Rubric;
  edited: boolean;
  createdAt: string;
};

export type Session = {
  id: string;
  title: string;
  story: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  iterations: Iteration[];
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  iterationCount: number;
  latest: {
    order: number;
    lintOk: boolean;
    errors: number;
    warnings: number;
    verdict: Verdict | null;
  } | null;
};
