// ============================================================
// Lead Notify state — tracks which Odoo lead IDs already sent to Teams
// Prevents duplicate notifications across cron runs.
//
// Also tracks per-customer dedup: Odoo can create multiple distinct
// crm.lead/opportunity records (real, different IDs) for the same
// customer within a short window — e.g. a sale touching an existing
// customer's order re-spawns a new opportunity. ID-based dedup can't
// catch this since each one is a genuinely new lead ID; this second,
// identity-based layer stops the Teams channel from being spammed with
// several "Lead mới" cards for the same customer in a short span.
// ============================================================

import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";

const STORE_PATH = path.join(process.cwd(), "data", "leads-notified.json");
const CUSTOMER_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

// Was a count-capped FIFO array (MAX_IDS=2000, oldest evicted first) — same
// bug class as orders-notify.ts's notifiedDraftIds/etc: a count cap has no
// relationship to how long a lead ID actually needs to stay "known", so it
// can silently evict a recent lead and cause a resend. Switched to
// time-based retention for the same reason (see lib/orders-notify.ts).
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const RAW_HARD_CAP = 200_000;

interface NotifiedEntry {
  id: number;
  at: string; // ISO — when this lead ID was marked notified ("Lead mới" sent)
}

function normalizeEntries(raw: unknown, fallbackAt: string): NotifiedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item =>
    typeof item === "number" ? { id: item, at: fallbackAt } : (item as NotifiedEntry)
  );
}

function pruneEntries(entries: NotifiedEntry[]): NotifiedEntry[] {
  const cutoff = Date.now() - RETENTION_MS;
  const byId = new Map<number, NotifiedEntry>();
  for (const e of entries) {
    if (new Date(e.at).getTime() < cutoff) continue;
    byId.set(e.id, e);
  }
  const result = [...byId.values()];
  return result.length > RAW_HARD_CAP ? result.slice(-RAW_HARD_CAP) : result;
}

interface LeadsNotifyStore {
  updatedAt: string;
  notifiedIds: NotifiedEntry[];
  lastCheckedAt: string | null;
  // customerKey -> ISO timestamp of the last Teams notification sent for that customer
  customerLastNotifiedAt: Record<string, string>;
}

function readStore(): LeadsNotifyStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as Partial<LeadsNotifyStore>;
    const fallbackAt = parsed.updatedAt ?? new Date().toISOString();
    return {
      updatedAt: fallbackAt,
      notifiedIds: normalizeEntries(parsed.notifiedIds, fallbackAt),
      lastCheckedAt: parsed.lastCheckedAt ?? null,
      customerLastNotifiedAt: parsed.customerLastNotifiedAt ?? {},
    };
  } catch {
    return { updatedAt: new Date().toISOString(), notifiedIds: [], lastCheckedAt: null, customerLastNotifiedAt: {} };
  }
}

function pruneCustomerMap(map: Record<string, string>): Record<string, string> {
  const cutoff = Date.now() - CUSTOMER_DEDUP_WINDOW_MS;
  const pruned: Record<string, string> = {};
  for (const [key, iso] of Object.entries(map)) {
    if (new Date(iso).getTime() >= cutoff) pruned[key] = iso;
  }
  return pruned;
}

// ── Dự phòng trong bộ nhớ khi KHÔNG ghi được xuống đĩa ───────
//
// Thêm 17/09/2026 sau sự cố máy chủ hết dung lượng (ENOSPC). Trước đó, nếu
// writeStore() ném lỗi thì thẻ ĐÃ gửi lên Teams nhưng id KHÔNG được ghi lại,
// nên 5 phút sau cron lại coi lead đó là mới và gửi lại — cứ thế 5 phút một
// lần cho tới khi ai đó dọn đĩa. Im lặng đã tệ, bão thẻ trùng còn tệ hơn.
//
// Tập này sống theo tiến trình: mất khi container khởi động lại, nhưng đúng
// lúc cần nhất (đĩa hỏng, tiến trình vẫn chạy) thì nó giữ cho không gửi trùng.
const memoryNotifiedIds = new Set<number>();
const memoryCustomerNotifiedAt = new Map<string, number>();

/** true = ghi được; false = hỏng (đã ghi log), chỗ gọi tự chuyển sang bộ nhớ. */
function writeStore(store: LeadsNotifyStore): boolean {
  store.notifiedIds = pruneEntries(store.notifiedIds);
  store.customerLastNotifiedAt = pruneCustomerMap(store.customerLastNotifiedAt);
  store.updatedAt = new Date().toISOString();
  try {
    writeFileAtomicSync(STORE_PATH, JSON.stringify(store, null, 2));
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    const hint = code === "ENOSPC" ? " — MÁY CHỦ HẾT DUNG LƯỢNG ĐĨA" : "";
    console.error(
      `[leads-notify] KHÔNG ghi được ${STORE_PATH}${hint}: ${err instanceof Error ? err.message : String(err)}. ` +
      `Tạm dùng bộ nhớ tiến trình để không gửi trùng; state sẽ mất khi khởi động lại.`
    );
    return false;
  }
}

export function getNotifiedIds(): Set<number> {
  const ids = new Set(readStore().notifiedIds.map(e => e.id));
  for (const id of memoryNotifiedIds) ids.add(id);   // gộp phần chưa ghi được đĩa
  return ids;
}

export function markNotified(ids: number[]): void {
  // Ghi vào bộ nhớ TRƯỚC khi đụng đĩa: nếu đĩa hỏng thì phần này vẫn giữ,
  // và đây là thông tin "đã gửi rồi" — mất nó mới gây gửi trùng.
  for (const id of ids) memoryNotifiedIds.add(id);

  const store = readStore();
  const now = new Date().toISOString();
  store.notifiedIds = [...store.notifiedIds, ...ids.map(id => ({ id, at: now }))];
  store.lastCheckedAt = now;
  if (writeStore(store)) {
    // Đã bền trên đĩa → không cần giữ trong bộ nhớ nữa.
    for (const id of ids) memoryNotifiedIds.delete(id);
  }
}

// ─── Cross-link: order-side dedup ──────────────────────────
// By request 2026-08-17: converting a matbao.in Lead straight into a Sale
// Order (e.g. lead "THIEN TRAN" → order S6564734) was firing BOTH a
// "🔔 Lead mới" card and a "🔔 Đơn chờ thanh toán"/"✅ Đơn đã thanh toán" card
// for what staff perceive as the same event. orders-notify.ts calls this
// (via order.opportunity_id, which IS the crm.lead id) before sending a
// draft/paid card, and skips the order card if that lead already got its
// own "Lead mới" card within the window — one signal per real event instead
// of two uncoordinated pollers both firing.
const LEAD_ORDER_DEDUP_WINDOW_MS = CUSTOMER_DEDUP_WINDOW_MS; // 6h — same window as the existing per-customer lead dedup

export function wasLeadRecentlyNotified(leadId: number): boolean {
  const entry = readStore().notifiedIds.find(e => e.id === leadId);
  if (!entry) return false;
  return Date.now() - new Date(entry.at).getTime() < LEAD_ORDER_DEDUP_WINDOW_MS;
}

/** True if a Teams notification was already sent for this customer within the last 6h. */
export function wasCustomerRecentlyNotified(customerKey: string): boolean {
  const store = readStore();
  const onDisk = store.customerLastNotifiedAt[customerKey];
  const inMem = memoryCustomerNotifiedAt.get(customerKey);
  // Lấy mốc MỚI HƠN giữa đĩa và bộ nhớ — bộ nhớ là phần chưa ghi được xuống đĩa.
  const lastMs = Math.max(onDisk ? new Date(onDisk).getTime() : 0, inMem ?? 0);
  if (!lastMs) return false;
  return Date.now() - lastMs < CUSTOMER_DEDUP_WINDOW_MS;
}

export function markCustomerNotified(customerKey: string): void {
  const nowMs = Date.now();
  memoryCustomerNotifiedAt.set(customerKey, nowMs);
  const store = readStore();
  store.customerLastNotifiedAt[customerKey] = new Date(nowMs).toISOString();
  if (writeStore(store)) memoryCustomerNotifiedAt.delete(customerKey);
}
