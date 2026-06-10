import Link from "next/link";

import { prisma } from "@/lib/db";
import { HealthBanner } from "@/components/HealthBanner";
import { DailyBrief } from "@/components/DailyBrief";
import { DashboardToolGrid } from "@/components/DashboardToolGrid";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function greeting(name: string | null): string {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export default async function Dashboard() {
  let recent: { id: string; title: string }[] = [];
  let userName: string | null = null;
  let firstRun = false;
  try {
    const [recentRows, settings, projects, prompts, tasks, facts] = await Promise.all([
      prisma.prompt.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true },
      }),
      prisma.settings.findUnique({ where: { id: "singleton" }, select: { userName: true } }),
      prisma.project.count(),
      prisma.prompt.count(),
      prisma.task.count(),
      prisma.memoryFact.count(),
    ]);
    recent = recentRows;
    userName = settings?.userName ?? null;
    firstRun = projects + prompts + tasks + facts === 0;
  } catch {
    // DB not migrated yet — treat as a first run.
    firstRun = true;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">{greeting(userName)}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your local AI cockpit. Everything runs on this machine.</p>

      <div className="mt-6">
        <HealthBanner />
      </div>

      {firstRun && (
        <Card className="mt-6 border-dashed">
          <CardContent className="p-5">
            <h2 className="font-semibold">First run? Three things to know</h2>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Everything is local.</span> The model,
                the data, this page — nothing leaves this machine. Run{" "}
                <code className="rounded bg-muted px-1 py-0.5">./swiss doctor</code> (macOS) or{" "}
                <code className="rounded bg-muted px-1 py-0.5">.\swiss doctor</code> (Windows) in
                the repo for a full preflight.
              </li>
              <li>
                <span className="font-medium text-foreground">Projects are optional.</span> With no
                project selected you work in the global space. Create one under{" "}
                <Link href="/tools/projects" className="underline underline-offset-2">
                  Projects
                </Link>{" "}
                to scope memory, tasks, and prompts — and switch any time in the sidebar.
              </li>
              <li>
                <span className="font-medium text-foreground">⌘K (Ctrl K on Windows) opens the
                palette.</span>{" "}
                Search everything, ask a one-shot question, or quick-add a note from anywhere.
              </li>
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">
              Good first stop:{" "}
              <Link href="/tools/prompt-optimizer" className="underline underline-offset-2">
                Prompt Optimizer
              </Link>
              . Set your name and model in{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Settings
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <DailyBrief />
      </div>

      <h2 className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tools</h2>
      <DashboardToolGrid />

      {recent.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent prompts</h2>
          <ul className="mt-2 space-y-1">
            {recent.map((p) => (
              <li key={p.id} className="truncate text-sm">
                <Link href="/tools/prompt-library" className="text-foreground/80 hover:text-foreground hover:underline">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
