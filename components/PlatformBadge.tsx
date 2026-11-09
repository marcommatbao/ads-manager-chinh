import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Platform } from "@/types/ads.types";

interface PlatformBadgeProps {
  platform: Platform;
  className?: string;
}

const platformConfig: Record<
  Platform,
  { label: string; dotColor: string; badgeClass: string }
> = {
  facebook: {
    label: "Facebook",
    dotColor: "bg-blue-600",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50",
  },
  google: {
    label: "Google",
    dotColor: "bg-amber-500",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50",
  },
  all: {
    label: "All",
    dotColor: "bg-slate-400",
    badgeClass: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-50",
  },
};

export default function PlatformBadge({
  platform,
  className,
}: PlatformBadgeProps) {
  const config = platformConfig[platform];

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        config.badgeClass,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dotColor)} />
      {config.label}
    </Badge>
  );
}
