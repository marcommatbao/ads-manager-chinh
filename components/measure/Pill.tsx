// ============================================================
// Pill trạng thái dùng chung cho "Sức khoẻ đo lường" + "Theo dõi phiên xử lý".
// LUÔN kèm icon/ký hiệu + chữ trong `children` — không dùng riêng màu (cùng
// luật với components/case/StatusPill.tsx).
// ============================================================
import { cn } from "@/lib/utils";

export type PillTone = "red" | "amber" | "green" | "grey" | "blue";

const TONE_CLS: Record<PillTone, string> = {
  red: "bg-red-50 text-red-700 border-red-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  grey: "bg-slate-50 text-slate-500 border-slate-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
};

export function Pill({
  tone,
  children,
  className,
}: {
  tone: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-normal",
        TONE_CLS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
