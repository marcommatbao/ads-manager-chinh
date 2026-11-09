// ============================================================
// Orders Notify state — tracks which Odoo sale.order IDs already sent to Teams
// Two independent sets: draft (unpaid) and paid (confirmed).
// ============================================================

import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

const STORE_PATH = path.join(process.cwd(), "data", "orders-notified.json");

// Was a flat, count-capped FIFO array (MAX_IDS=5000, oldest evicted first on
// every write) — confirmed live-plausible root cause of orders re-notifying
// on later edits: the draft pipeline re-scans the ENTIRE open draft/sent
// backlog every 5 minutes (see route.ts), so once an order's ID aged out of
// this array it looked brand-new again on the very next poll, no edit
// required. At ~400+/day observed order volume, 5000 slots exhausts in
// weeks — squarely inside a normal order's real lifecycle. Retention is now
// TIME-based (an order stays "known" for RETENTION_DAYS regardless of how
// many other orders were notified in between), same defense-in-depth spirit
// as ROLLOUT_CUTOFF_UTC in route.ts. RAW_HARD_CAP is only a sanity backstop
// against unbounded growth if retention pruning itself ever breaks — at
// realistic volume it should never actually bind.
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const RAW_HARD_CAP = 200_000;

interface NotifiedEntry {
  id: number;
  at: string; // ISO — when this ID was marked notified
}

function normalizeEntries(raw: unknown, fallbackAt: string): NotifiedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item =>
    typeof item === "number" ? { id: item, at: fallbackAt } : (item as NotifiedEntry)
  );
}

// Drop entries older than RETENTION_MS, dedupe by id (last write wins), and
// only fall back to the hard cap if retention pruning somehow isn't enough.
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

interface OrdersNotifyStore {
  updatedAt: string;
  lastCheckedAt: string | null;
  notifiedDraftIds: NotifiedEntry[];
  notifiedPaidIds: NotifiedEntry[];
  // Orders that transitioned to `cancel` (e.g. abandoned online payment) —
  // tracked separately so sales gets a "call back" signal even when the
  // order never sat in `draft` long enough for the draft pipeline to catch it.
  notifiedCancelIds: NotifiedEntry[];
  // phone dedup: skip if same phone notified within 2h window
  recentPhones: { phone: string; notifiedAt: string }[];
  // One-time marker: on request, the entire pre-existing draft/sent backlog
  // (surfaced by the 30-day state scan) was silenced without sending —
  // "start fresh from today" — so only orders new/changed after this point
  // ever get a card. Runs exactly once; never reset automatically.
  backlogSilencedAt: string | null;
  // Same as above, but for the paid (state=sale) backlog — closes the class
  // of bug seen on S6515670 (confirmed weeks earlier, never notified, then
  // re-surfaced by an unrelated field edit bumping write_date).
  paidBacklogSilencedAt: string | null;
  // Same class of bug, same fix, for the cancel backlog — confirmed live on
  // S6500112/S6492833 (cancelled weeks earlier, never notified, resurfaced
  // as "new" today because something touched the record and bumped
  // write_date). This one was missing the whole time; draft and paid got
  // silenced, cancel never did.
  cancelBacklogSilencedAt: string | null;
  // One-time marker for the 2026-07-21 change that removed skipReason
  // entirely (no more name/phone quality gate — see route.ts): silences
  // whatever's already open in the draft/cancel backlog at rollout so
  // removing the filter doesn't surface the whole existing backlog (which
  // was previously held back by that filter) all at once. Runs exactly
  // once; never reset automatically.
  noFilterRolloutSilencedAt: string | null;
  // One-time marker for the 2026-07-25 change from the old source_id-based
  // qualification rule to the confirmed-correct customer_source-based one
  // (see lib/mbi-order-sources.ts) — the new rule catches real MBI/MKT
  // orders (mostly "Kênh chat") the old rule never checked at all. Without
  // this, the entire pre-existing backlog of such orders would flood Teams
  // the moment this deploys. Silences draft/paid/cancel backlogs exactly
  // once at rollout, same "start fresh from today" pattern as the markers
  // above; never reset automatically.
  customerSourceRolloutSilencedAt: string | null;
  /** @deprecated renamed to notifiedDraftIds — migrated on first read */
  notifiedIds?: number[];
}

function readStore(): OrdersNotifyStore {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as OrdersNotifyStore;
    // Migrate legacy notifiedIds → notifiedDraftIds
    if (raw.notifiedIds && !raw.notifiedDraftIds) {
      raw.notifiedDraftIds = raw.notifiedIds as unknown as NotifiedEntry[];
      delete raw.notifiedIds;
    }
    // Migrate legacy plain-number arrays (pre time-based-retention format) —
    // fallback `at` = now, so migrated entries get a full fresh retention
    // window starting today rather than risking an immediate/incorrect prune.
    const fallbackAt = raw.updatedAt ?? new Date().toISOString();
    raw.notifiedDraftIds  = normalizeEntries(raw.notifiedDraftIds, fallbackAt);
    raw.notifiedPaidIds   = normalizeEntries(raw.notifiedPaidIds, fallbackAt);
    raw.notifiedCancelIds = normalizeEntries(raw.notifiedCancelIds, fallbackAt);
    raw.recentPhones           ??= [];
    raw.backlogSilencedAt        ??= null;
    raw.paidBacklogSilencedAt    ??= null;
    raw.cancelBacklogSilencedAt  ??= null;
    raw.noFilterRolloutSilencedAt ??= null;
    raw.customerSourceRolloutSilencedAt ??= null;
    return raw;
  } catch {
    return {
      updatedAt: new Date().toISOString(), lastCheckedAt: null,
      notifiedDraftIds: [], notifiedPaidIds: [], notifiedCancelIds: [], recentPhones: [],
      backlogSilencedAt: null, paidBacklogSilencedAt: null, cancelBacklogSilencedAt: null,
      noFilterRolloutSilencedAt: null, customerSourceRolloutSilencedAt: null,
    };
  }
}

const PHONE_DEDUP_MS = 2 * 60 * 60 * 1000; // 2 hours

function writeStore(store: OrdersNotifyStore): void {
  store.notifiedDraftIds  = pruneEntries(store.notifiedDraftIds);
  store.notifiedPaidIds   = pruneEntries(store.notifiedPaidIds);
  store.notifiedCancelIds = pruneEntries(store.notifiedCancelIds);
  // Prune recentPhones older than dedup window
  const cutoff = new Date(Date.now() - PHONE_DEDUP_MS).toISOString();
  store.recentPhones = store.recentPhones.filter(p => p.notifiedAt > cutoff);
  store.updatedAt = new Date().toISOString();
  writeFileAtomicSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getNotifiedDraftIds(): Set<number> {
  return new Set(readStore().notifiedDraftIds.map(e => e.id));
}

export function getNotifiedPaidIds(): Set<number> {
  return new Set(readStore().notifiedPaidIds.map(e => e.id));
}

export function getNotifiedCancelIds(): Set<number> {
  return new Set(readStore().notifiedCancelIds.map(e => e.id));
}

export function getBacklogSilencedAt(): string | null {
  return readStore().backlogSilencedAt;
}

export function markBacklogSilenced(): void {
  const store = readStore();
  store.backlogSilencedAt = new Date().toISOString();
  writeStore(store);
}

export function getPaidBacklogSilencedAt(): string | null {
  return readStore().paidBacklogSilencedAt;
}

export function markPaidBacklogSilenced(): void {
  const store = readStore();
  store.paidBacklogSilencedAt = new Date().toISOString();
  writeStore(store);
}

export function getCancelBacklogSilencedAt(): string | null {
  return readStore().cancelBacklogSilencedAt;
}

export function markCancelBacklogSilenced(): void {
  const store = readStore();
  store.cancelBacklogSilencedAt = new Date().toISOString();
  writeStore(store);
}

export function getNoFilterRolloutSilencedAt(): string | null {
  return readStore().noFilterRolloutSilencedAt;
}

export function markNoFilterRolloutSilenced(): void {
  const store = readStore();
  store.noFilterRolloutSilencedAt = new Date().toISOString();
  writeStore(store);
}

export function getCustomerSourceRolloutSilencedAt(): string | null {
  return readStore().customerSourceRolloutSilencedAt;
}

export function markCustomerSourceRolloutSilenced(): void {
  const store = readStore();
  store.customerSourceRolloutSilencedAt = new Date().toISOString();
  writeStore(store);
}

export function getLastCheckedAt(): string | null {
  return readStore().lastCheckedAt;
}

// Advance the checkpoint even when a run finds nothing new — otherwise the
// next run's lookback window keeps starting from a stale point and never
// tightens back up.
export function touchLastChecked(): void {
  const store = readStore();
  store.lastCheckedAt = new Date().toISOString();
  writeStore(store);
}

export function markNotifiedDraft(ids: number[]): void {
  const store = readStore();
  const now = new Date().toISOString();
  store.notifiedDraftIds = [...store.notifiedDraftIds, ...ids.map(id => ({ id, at: now }))];
  store.lastCheckedAt = now;
  writeStore(store);
}

export function markNotifiedPaid(ids: number[]): void {
  const store = readStore();
  const now = new Date().toISOString();
  store.notifiedPaidIds = [...store.notifiedPaidIds, ...ids.map(id => ({ id, at: now }))];
  store.lastCheckedAt = now;
  writeStore(store);
}

export function markNotifiedCancel(ids: number[]): void {
  const store = readStore();
  const now = new Date().toISOString();
  store.notifiedCancelIds = [...store.notifiedCancelIds, ...ids.map(id => ({ id, at: now }))];
  store.lastCheckedAt = now;
  writeStore(store);
}

// ─── Phone dedup ──────────────────────────────────────────

export function wasPhoneRecentlyNotified(phone: string): boolean {
  const store = readStore();
  const cutoff = Date.now() - PHONE_DEDUP_MS;
  return store.recentPhones.some(p => p.phone === phone && new Date(p.notifiedAt).getTime() > cutoff);
}

export function markPhoneNotified(phone: string): void {
  const store = readStore();
  store.recentPhones.push({ phone, notifiedAt: new Date().toISOString() });
  writeStore(store);
}

// Keep old exports for any other callers during transition
export const getNotifiedOrderIds = getNotifiedDraftIds;
export const markNotifiedOrders  = markNotifiedDraft;

// ─── Event log — per-order send/skip detail ────────────────
// job-history's resultSummary only ever carried aggregate counts
// ("draft 0/1 sent, skipped 1") with no way to tell WHICH order or WHY —
// confirmed painful live on S6537276 (2026-07-21): had to guess at the
// reason instead of just looking it up. This logs one entry per
// send/skip/error decision so it can be inspected from the browser
// (see /api/cron/orders-notify/events) without server/container access.

const EVENTS_PATH = path.join(process.cwd(), "data", "orders-notify-events.json");
const MAX_EVENTS = 500;

export interface NotifyEvent {
  ts: string;
  pipeline: "draft" | "paid" | "cancel";
  action: "sent" | "skipped_permanent" | "skipped_retry" | "skipped_dedup" | "error";
  orderId: number;
  orderName: string;
  reason: string | null;
}

interface EventsFile {
  events: NotifyEvent[];
}

function readEvents(): EventsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8")) as EventsFile;
    raw.events ??= [];
    return raw;
  } catch {
    return { events: [] };
  }
}

// Batched, not per-order — a single cron run can now process hundreds of
// orders (the 2026-07-21 no-filter change removed the gate that used to
// keep this small), and a synchronous read+parse+write per order would be
// O(n) blocking file I/O in one request. Callers accumulate events in an
// array during their loop and flush once at the end, same batching
// convention already used by markNotifiedDraft/markNotifiedPaid/etc.
export function logNotifyEvents(events: Omit<NotifyEvent, "ts">[]): void {
  if (events.length === 0) return;
  const file = readEvents();
  const now = new Date().toISOString();
  file.events = [...events.map(e => ({ ts: now, ...e })).reverse(), ...file.events].slice(0, MAX_EVENTS);
  writeFileAtomicSync(EVENTS_PATH, JSON.stringify(file, null, 2));
}

export function getRecentNotifyEvents(limit = 200): NotifyEvent[] {
  return readEvents().events.slice(0, Math.max(0, limit));
}
