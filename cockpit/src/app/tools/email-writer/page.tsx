import { prisma } from "@/lib/db";
import { EmailWriter } from "@/components/email/EmailWriter";
import { RecentItems } from "@/components/RecentItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EmailWriterPage({
  searchParams,
}: {
  searchParams: Promise<{ draftId?: string }>;
}) {
  const { draftId } = await searchParams;
  const rows = await prisma.emailDraft
    .findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { project: { select: { name: true } } },
    })
    .catch(() => []);

  // The ⌘K deep link may target a draft outside the recent slice.
  let draftRows = rows;
  if (draftId && !rows.some((r) => r.id === draftId)) {
    const extra = await prisma.emailDraft
      .findUnique({ where: { id: draftId }, include: { project: { select: { name: true } } } })
      .catch(() => null);
    if (extra) draftRows = [extra, ...draftRows];
  }

  const drafts = draftRows.map((d) => ({
    id: d.id,
    title: d.title || "Untitled draft",
    badges: [d.mode, d.tone, d.length],
    body: d.body,
    project: d.project?.name ?? null,
    editValues: { title: d.title ?? "", body: d.body },
  }));

  return (
    <div className="max-w-3xl">
      <EmailWriter />
      <RecentItems
        heading="Recent drafts"
        items={drafts}
        deleteBase="/api/email"
        editBase="/api/email"
        searchable
        highlightId={draftId ?? null}
        editFields={[
          { key: "title", label: "Title" },
          { key: "body", label: "Body", multiline: true },
        ]}
      />
    </div>
  );
}
