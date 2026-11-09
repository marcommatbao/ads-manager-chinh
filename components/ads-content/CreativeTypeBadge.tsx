import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CreativeSourcePlatform } from "@/types/creative-content.types";

const TYPE_CONFIG: Record<CreativeSourcePlatform, { label: string; dotColor: string; badgeClass: string }> = {
  facebook: {
    label: "Facebook",
    dotColor: "bg-blue-600",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50",
  },
  google_search: {
    label: "Google Search",
    dotColor: "bg-amber-500",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50",
  },
  google_pmax: {
    label: "Google PMax",
    dotColor: "bg-violet-500",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50",
  },
};

export function CreativeTypeBadge({ platform, className }: { platform: CreativeSourcePlatform; className?: string }) {
  const config = TYPE_CONFIG[platform];
  return (
    <Badge
      variant="outline"
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium", config.badgeClass, className)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dotColor)} />
      {config.label}
    </Badge>
  );
}
