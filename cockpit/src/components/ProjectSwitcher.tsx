"use client";

import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProjectLite = { id: string; name: string };

const NONE = "__none__";

export function ProjectSwitcher({
  projects,
  activeId,
}: {
  projects: ProjectLite[];
  activeId: string | null;
}) {
  const router = useRouter();

  async function change(val: string) {
    const projectId = val === NONE ? null : val;
    await fetch("/api/projects/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    router.refresh();
  }

  return (
    <Select value={activeId ?? NONE} onValueChange={change}>
      <SelectTrigger
        className="h-8 text-xs"
        aria-label="Active project"
        title="New work is filed under the active project. With no project, it lands in the shared global space."
      >
        <SelectValue placeholder="No project — global" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No project — global</SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
