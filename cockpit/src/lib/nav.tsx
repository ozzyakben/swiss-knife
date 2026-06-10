import {
  LayoutDashboard,
  Wand2,
  Library,
  Mail,
  Lightbulb,
  Image as ImageIcon,
  Inbox,
  ListTodo,
  FlaskConical,
  ClipboardCheck,
  Bug,
  Scale,
  SearchCode,
  ListChecks,
  TestTubes,
  Webhook,
  Brain,
  Activity,
  FolderKanban,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "work" | "write" | "qa" | "dev" | "system";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Short description; present items are featured as dashboard cards. */
  desc?: string;
  /** Sidebar section. Dashboard is ungrouped (always first). */
  group?: NavGroup;
  /** Extra ⌘K match terms (the palette derives from this registry). */
  keywords?: string;
};

export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "work", label: "Work" },
  { id: "write", label: "Write" },
  { id: "qa", label: "QA & Evals" },
  { id: "dev", label: "Dev" },
  { id: "system", label: "System" },
];

// Single source of truth for navigation, the dashboard cards, AND the command
// palette (which used to hand-copy this list and drifted). Sidebar groups make
// the seams visible now that there are 20+ destinations.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "home brief today" },

  // Work — the persisted surfaces a day runs on.
  { href: "/tools/tasks", label: "Tasks", icon: ListTodo, group: "work", desc: "List + Kanban with AI assists.", keywords: "todo kanban board" },
  { href: "/tools/inbox", label: "Smart Inbox", icon: Inbox, group: "work", desc: "Drop or paste anything; it's auto-sorted.", keywords: "drop paste sort capture" },
  { href: "/tools/memory", label: "Memory", icon: Brain, group: "work", desc: "Facts woven into your tools.", keywords: "facts glossary" },
  { href: "/tools/projects", label: "Projects", icon: FolderKanban, group: "work", desc: "Group work; deep-link to Open WebUI.", keywords: "hub" },

  // Write — drafting tools on the local model.
  { href: "/tools/prompt-optimizer", label: "Prompt Optimizer", icon: Wand2, group: "write", desc: "Sharpen a rough prompt.", keywords: "sharpen" },
  { href: "/tools/prompt-library", label: "Prompt Library", icon: Library, group: "write", desc: "Saved prompts + variable templates.", keywords: "templates" },
  { href: "/tools/email-writer", label: "Email Writer", icon: Mail, group: "write", desc: "Compose and reply with the right tone.", keywords: "compose reply" },
  { href: "/tools/brainstorm", label: "Brainstorming", icon: Lightbulb, group: "write", desc: "Structured thinking techniques.", keywords: "ideas techniques" },
  { href: "/tools/image", label: "Image", icon: ImageIcon, group: "write", desc: "Ask Gemma about an image.", keywords: "vision photo screenshot ocr" },

  // QA & Evals — the SDET / AI-engineer workbench.
  { href: "/tools/qa-pipeline", label: "QA Pipeline", icon: ClipboardCheck, group: "qa", desc: "Story → Gherkin → lint → rubric.", keywords: "story rubric test bench golden" },
  { href: "/tools/gherkin-lint", label: "Gherkin Lint", icon: FlaskConical, group: "qa", desc: "Check .feature files for BDD hygiene.", keywords: "bdd feature" },
  { href: "/tools/bug-report", label: "Bug Report", icon: Bug, group: "qa", desc: "Rough note → a structured bug report.", keywords: "defect repro severity" },
  { href: "/tools/rubric-designer", label: "Rubric Designer", icon: ListChecks, group: "qa", desc: "The bar → a gated, weighted eval rubric.", keywords: "eval rubric weights bands score" },
  { href: "/tools/eval-cases", label: "Eval Cases", icon: TestTubes, group: "qa", desc: "Spec → coverage-gated eval cases.", keywords: "golden test cases coverage adversarial boundary" },

  // Dev — code-facing tools.
  { href: "/tools/code-review", label: "Code Review", icon: SearchCode, group: "dev", desc: "Smell scan + AI explanation of findings.", keywords: "smells complexity big-o diff lint" },
  { href: "/tools/adr", label: "ADR Writer", icon: Scale, group: "dev", desc: "Decision note → a gated MADR record.", keywords: "decision record madr architecture" },
  { href: "/tools/api-contract", label: "API Contract", icon: Webhook, group: "dev", desc: "Prose → validated OpenAPI 3.1.", keywords: "openapi swagger rest endpoint yaml" },

  // System — meta surfaces.
  { href: "/tools/activity", label: "Activity", icon: Activity, group: "system", desc: "A timeline of what happened.", keywords: "timeline log history" },
  { href: "/settings", label: "Settings", icon: SettingsIcon, group: "system", keywords: "model theme health backup" },
];

/** Items featured as cards on the dashboard (everything with a description). */
export const FEATURED_TOOLS = NAV_ITEMS.filter((i) => i.desc);
