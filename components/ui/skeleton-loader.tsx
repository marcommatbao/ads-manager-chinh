// ─────────────────────────────────────────────
// Skeleton Loader — reusable loading placeholders
// ─────────────────────────────────────────────
import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-slate-100", className)}
    />
  );
}

// KPI grid skeleton (4 cards)
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

// Table rows skeleton
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <Skeleton className="h-4 w-48" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-slate-50 flex items-center gap-4">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// Campaign card skeletons (mobile)
export function CampaignCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Full page loading
export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <KpiSkeleton />
      <Skeleton className="h-64 rounded-xl" />
      <TableSkeleton rows={5} />
    </div>
  );
}
