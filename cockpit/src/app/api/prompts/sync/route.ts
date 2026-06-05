import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWUI_BASE = process.env.OWUI_BASE_URL || "http://localhost:3001";

/**
 * One-way push of saved prompts into Open WebUI's prompt library. Needs an
 * Open WebUI API key (Settings → Open WebUI sync). Idempotent: existing
 * commands are UPDATED (not skipped), so re-syncing refreshes content. Fails
 * loudly when Open WebUI is unreachable or the key is rejected.
 */
export async function POST() {
  const s = await prisma.settings.findUnique({ where: { id: "singleton" } }).catch(() => null);
  const key = s?.owuiApiKey;
  if (!key) {
    return Response.json(
      { error: "Set your Open WebUI API key in Settings to sync." },
      { status: 400 }
    );
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };

  // Which commands already exist in Open WebUI? (Also our connectivity/auth probe.)
  const existing = new Set<string>();
  try {
    const listRes = await fetch(`${OWUI_BASE}/api/v1/prompts/`, { headers, cache: "no-store" });
    if (listRes.status === 401 || listRes.status === 403) {
      return Response.json(
        { error: "Open WebUI rejected the API key. Recreate it in Open WebUI → Settings → Account → API Keys." },
        { status: 502 }
      );
    }
    if (listRes.ok) {
      const arr = (await listRes.json().catch(() => [])) as Array<{ command?: string }>;
      for (const x of arr) if (x.command) existing.add(x.command);
    }
  } catch {
    return Response.json(
      { error: `Couldn't reach Open WebUI at ${OWUI_BASE}. Is the container running (docker compose up -d open-webui)?` },
      { status: 502 }
    );
  }

  const prompts = await prisma.prompt.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const p of prompts) {
    const content = p.optimized || p.original;
    const command = `/sk-${p.id.slice(-8)}`; // stable per-prompt command
    const body = JSON.stringify({ command, title: p.title.slice(0, 100), content });
    try {
      if (existing.has(command)) {
        // command includes its leading slash, so the URL is .../command/sk-xxxx/update
        const res = await fetch(`${OWUI_BASE}/api/v1/prompts/command${command}/update`, {
          method: "POST",
          headers,
          body,
        });
        res.ok ? updated++ : failed++;
      } else {
        const res = await fetch(`${OWUI_BASE}/api/v1/prompts/create`, {
          method: "POST",
          headers,
          body,
        });
        res.ok ? created++ : failed++;
      }
    } catch {
      failed++;
    }
  }

  return Response.json({
    ok: true,
    created,
    updated,
    failed,
    synced: created + updated,
    total: prompts.length,
  });
}
