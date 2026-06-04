import { prisma } from "@/lib/db";
import { EmailWriter } from "@/components/email/EmailWriter";
import { RecentItems } from "@/components/RecentItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EmailWriterPage() {
  const rows = await prisma.emailDraft
    .findMany({ orderBy: { createdAt: "desc" }, take: 20 })
    .catch(() => []);

  const drafts = rows.map((d) => ({
    id: d.id,
    title: d.title || "Untitled draft",
    badges: [d.mode, d.tone, d.length],
    body: d.body,
  }));

  return (
    <div className="max-w-3xl">
      <EmailWriter />
      <RecentItems heading="Recent drafts" items={drafts} deleteBase="/api/email" />
    </div>
  );
}
