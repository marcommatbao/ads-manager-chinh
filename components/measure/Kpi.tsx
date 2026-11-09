// ============================================================
// Thẻ KPI nhỏ dùng chung cho Sức khoẻ đo lường + Theo dõi phiên xử lý
// (cùng mẫu với Kpi cục bộ trong app/(dashboard)/xu-ly/page.tsx).
// ============================================================
import { cn } from "@/lib/utils";

export function Kpi({
  label,
  value,
  sub,
  bad,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  bad?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", bad ? "text-red-600" : "text-slate-900")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
