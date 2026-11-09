import { canAccessCompany } from "@/lib/permissions";
import type { MonthKpi } from "@/lib/settings/kpi-store";

// Đợt 21 A5b: ô KPI thuộc công ty nào. Admin một công ty (admin_mbc…) trước đây sửa được CẢ ô của công ty kia.
const KPI_FIELD_COMPANY: Record<Exclude<keyof MonthKpi, "extraSpend">, string> = {
  revenueMbc: "MBC", adSpendMbc: "MBC", adSpendMbcByChannel: "MBC",
  adSpendMbi: "MBI", ordersMbi: "MBI", adSpendMbiByChannel: "MBI",
};
/** Tên các ô bị đổi thuộc công ty người sửa KHÔNG được giao (rỗng = được lưu). */
export function kpiForbiddenChanges(user: Parameters<typeof canAccessCompany>[0], oldMonths: MonthKpi[], newMonths: MonthKpi[]): string[] {
  const out = new Set<string>();
  newMonths.forEach((m, i) => {
    for (const [field, co] of Object.entries(KPI_FIELD_COMPANY) as [Exclude<keyof MonthKpi, "extraSpend">, string][]) {
      if (canAccessCompany(user, co)) continue;
      if (JSON.stringify(m?.[field] ?? null) !== JSON.stringify(oldMonths[i]?.[field] ?? null)) out.add(field);
    }
    // 12/10: khoản chi bổ sung chứa CẢ MBC lẫn MBI trong một danh sách → so theo TỪNG công ty người sửa không được giao:
    // các khoản của công ty đó (thêm / sửa / xoá) phải y nguyên.
    for (const co of ["MBC", "MBI"] as const) {
      if (canAccessCompany(user, co)) continue;
      // Thứ tự trường cố định: trình duyệt gửi khoá theo thứ tự khác tệp đã lưu thì nội dung y hệt vẫn phải bằng nhau.
      const pick = (arr: MonthKpi["extraSpend"] | undefined) =>
        JSON.stringify((arr ?? []).filter((e) => e?.company === co)
          .map((e) => [String(e.id ?? ""), e.company, e.channel, e.kind, Number(e.amount) || 0, e.note ?? "", e.campaignContains ?? ""])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      if (pick(m?.extraSpend) !== pick(oldMonths[i]?.extraSpend)) out.add(`extraSpend:${co}`);
    }
  });
  return [...out];
}

