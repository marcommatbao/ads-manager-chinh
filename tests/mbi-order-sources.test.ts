import { describe, expect, it } from "vitest";
import {
  MBI_CUSTOMER_SOURCE_IDS, MBI_ORDER_DOMAIN, MBI_SOURCE_LABELS,
  NOTIFY_CUSTOMER_SOURCE_IDS, NOTIFY_ORDER_DOMAIN,
  isQualifiedMbiOrder, isNotifiableOrder, mbiSourceLabel,
} from "@/lib/mbi-order-sources";
import { MKT_SOURCES, mktOrderDomain, mktOrderLineDomain } from "@/lib/odoo-mkt-orders";

const ids = [17, 29, 16, 19, 27, 243, 30];
const names = ["Kênh chat", "Đơn hàng MBI online", "Điện thoại vào công ty", "Yêu cầu phòng ban", "matbao.in", "Chat web - sale.ai.vn", "Đơn hàng ID"];
const order = (source: number, team = 60) => ({
  team_id: [team, "M-test"] as [number, string],
  customer_source: [source, "source"] as [number, string],
});

describe("MBI seven-source classification", () => {
  it("keeps the exact agreed IDs and names, including department requests and web chat", () => {
    expect(MBI_CUSTOMER_SOURCE_IDS).toEqual(ids);
    expect(MBI_SOURCE_LABELS).toEqual({
      17: "💬 Kênh chat", 29: "🌐 Đơn hàng MBI online", 16: "☎️ Điện thoại vào công ty",
      19: "Yêu cầu phòng ban", 27: "🌐 matbao.in", 243: "💬 Chat web - sale.ai.vn", 30: "🆔 Đơn hàng ID",
    });
    expect([...MKT_SOURCES].sort()).toEqual([...names].sort());
    expect(mbiSourceLabel(order(19))).toBe("Yêu cầu phòng ban");
    expect(mbiSourceLabel(order(243))).toBe("💬 Chat web - sale.ai.vn");
    expect(MBI_ORDER_DOMAIN).toContainEqual(["customer_source", "in", ids]);
  });

  it.each(ids)("qualifies source %i only for an allowed team", (id) => {
    expect(isQualifiedMbiOrder(order(id))).toBe(true);
    expect(isQualifiedMbiOrder(order(id, 999))).toBe(false);
  });

  it("rejects excluded and missing sources or teams", () => {
    expect(isQualifiedMbiOrder(order(999))).toBe(false);
    expect(isQualifiedMbiOrder({ ...order(19), customer_source: false })).toBe(false);
    expect(isQualifiedMbiOrder({ ...order(243), team_id: false })).toBe(false);
  });

  it("keeps notifications restricted to source 29 and allowed teams", () => {
    expect(NOTIFY_CUSTOMER_SOURCE_IDS).toEqual([29]);
    expect(NOTIFY_ORDER_DOMAIN).toEqual([
      ["team_id", "in", [60, 59, 39, 35, 53, 42, 54, 50]],
      ["customer_source", "in", [29]],
    ]);
    for (const id of ids) expect(isNotifiableOrder(order(id))).toBe(id === 29);
    expect(isNotifiableOrder(order(29, 999))).toBe(false);
    expect(isNotifiableOrder(order(999))).toBe(false);
  });

  it("filters MKT by customer_source.name with unchanged payment, team, type and dates", () => {
    const domain = mktOrderDomain("2026-11-01", "2026-11-26");
    expect(domain).toEqual([
      ["type_id.name", "not in", ["Đơn đồng bộ", "Đồng bộ dịch vụ V10"]],
      ["invoice_ids.payment_state", "in", ["in_payment", "paid"]],
      ["team_id.name", "like", "M-"],
      ["amount_untaxed", ">=", 1],
      ["customer_source.name", "in", MKT_SOURCES],
      ["date_order", ">=", "2026-11-01"],
      ["date_order", "<=", "2026-11-26 23:59:59"],
    ]);
    expect(mktOrderLineDomain("2026-11-01", "2026-11-26")).toEqual(
      domain.map(([field, ...rest]) => [`order_id.${field}`, ...rest]),
    );
  });
});
