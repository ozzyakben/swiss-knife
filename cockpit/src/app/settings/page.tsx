import { prisma } from "@/lib/db";
import { getEffectiveConfig, DEFAULTS } from "@/lib/config";
import { checkHealth } from "@/lib/health";
import { SettingsForm } from "@/components/SettingsForm";
import { HealthBanner } from "@/components/HealthBanner";
import { CaptureSetup } from "@/components/CaptureSetup";
import { OwuiSync } from "@/components/OwuiSync";
import { DataBackup } from "@/components/DataBackup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [config, health] = await Promise.all([getEffectiveConfig(), checkHealth()]);
  const row = await prisma.settings
    .findUnique({ where: { id: "singleton" }, select: { userName: true } })
    .catch(() => null);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-muted-foreground">
        Local engine configuration. These override the environment defaults.
      </p>

      <div className="mt-6">
        <HealthBanner initial={health} showWhenOk />
      </div>

      <div className="mt-6">
        <SettingsForm initialConfig={config} defaults={DEFAULTS} initialUserName={row?.userName ?? null} />
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <CaptureSetup />
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <OwuiSync />
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <DataBackup />
      </div>
    </div>
  );
}
