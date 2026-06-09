import Link from "next/link";

import { prisma } from "@/lib/db";
import { getActiveProjectId } from "@/lib/project";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { CommandHint } from "@/components/CommandHint";

const tools = [
  { href: "/", label: "Dashboard" },
  { href: "/tools/prompt-optimizer", label: "Prompt Optimizer" },
  { href: "/tools/prompt-library", label: "Prompt Library" },
  { href: "/tools/email-writer", label: "Email Writer" },
  { href: "/tools/brainstorm", label: "Brainstorming" },
  { href: "/tools/image", label: "Image" },
  { href: "/tools/tasks", label: "Tasks" },
  { href: "/tools/gherkin-lint", label: "Gherkin Lint" },
  { href: "/tools/qa-pipeline", label: "QA Pipeline" },
  { href: "/tools/memory", label: "Memory" },
  { href: "/tools/projects", label: "Projects" },
  { href: "/settings", label: "Settings" },
];

export default async function Sidebar() {
  const [projects, activeId] = await Promise.all([
    prisma.project
      .findMany({
        where: { archived: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      })
      .catch(() => [] as { id: string; name: string }[]),
    getActiveProjectId(),
  ]);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-lg font-semibold">🔧 Swiss Knife</span>
        <ThemeToggle />
      </div>

      <div className="mb-3">
        <ProjectSwitcher projects={projects} activeId={activeId} />
      </div>

      <div className="mb-4">
        <CommandHint />
      </div>

      <nav className="flex flex-col gap-1">
        {tools.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-accent hover:text-accent-foreground"
          >
            {t.label}
          </Link>
        ))}
        <a
          href="http://localhost:3001"
          target="_blank"
          rel="noreferrer"
          className="mt-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Open WebUI ↗
        </a>
      </nav>

      <div className="mt-auto pt-8 text-xs text-muted-foreground">Powered by local Gemma 4 12B</div>
    </aside>
  );
}
