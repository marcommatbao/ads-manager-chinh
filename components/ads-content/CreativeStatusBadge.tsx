import { StatusBadge } from "@/components/CampaignTable";
import { cn } from "@/lib/utils";
import type { CreativeEntityStatus } from "@/types/creative-content.types";

export function CreativeStatusBadge({ status }: { status: CreativeEntityStatus }) {
  if (status === "UNKNOWN") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-slate-400")}>
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        Unknown
      </span>
    );
  }
  return <StatusBadge status={status} />;
}
