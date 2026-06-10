import { QaPipeline } from "@/components/qa/QaPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QaPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  return <QaPipeline initialSessionId={session ?? null} />;
}
