// ============================================================
// POST /api/settings/rollback
// Body: { domain: SettingsDomain, snapshot_id: string, note?: string }
// Restores a config snapshot. Super admin only.
// Supported domains: budget, cpl_thresholds, revenue, kpi
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findSnapshot, writeAuditEntry, writeAuditSnapshot } from "@/lib/settings/audit";
import { saveCplThresholds, getCplThresholds } from "@/lib/cpl-calculator";
import { saveKpiYear } from "@/lib/settings/kpi-store";
import { ROLLBACK_ELIGIBLE_DOMAINS, type SettingsDomain } from "@/lib/settings/types";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";

const BUDGET_CONFIG_FILE      = path.join(process.cwd(), "data", "global-budget-config.json");
const REVENUE_TARGETS_FILE    = path.join(process.cwd(), "data", "revenue-targets.json");

function readJson(filePath: string): unknown | null {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* ignore */ }
  return null;
}

function writeJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(filePath, JSON.stringify(data, null, 2));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Chỉ Super Admin mới có quyền rollback" }, { status: 403 });
  }

  let body: { domain?: SettingsDomain; snapshot_id?: string; note?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { domain, snapshot_id, note } = body;
  if (!domain || !snapshot_id) {
    return NextResponse.json({ error: "domain và snapshot_id là bắt buộc" }, { status: 400 });
  }

  if (!ROLLBACK_ELIGIBLE_DOMAINS.includes(domain)) {
    return NextResponse.json(
      { error: `Domain '${domain}' không hỗ trợ rollback. Hỗ trợ: ${ROLLBACK_ELIGIBLE_DOMAINS.join(", ")}` },
      { status: 400 },
    );
  }

  const snap = findSnapshot(domain, snapshot_id);
  if (!snap) {
    return NextResponse.json({ error: "Snapshot không tồn tại hoặc đã bị purge" }, { status: 404 });
  }

  // ── budget ───────────────────────────────────────────────
  if (domain === "budget") {
    const current = readJson(BUDGET_CONFIG_FILE);
    await writeAuditSnapshot("budget", user, current);
    writeJson(BUDGET_CONFIG_FILE, snap.data);
    await writeAuditEntry("budget", user, "update", "rollback",
      { snapshot_id, snapshot_ts: snap.timestamp }, snap.data, "ALL",
      { note: note ?? "rollback", rollbackReference: snapshot_id },
    );
    return NextResponse.json({ success: true, restored_from: snap.timestamp, data: snap.data });
  }

  // ── cpl_thresholds ────────────────────────────────────────
  if (domain === "cpl_thresholds") {
    const current = getCplThresholds();
    await writeAuditSnapshot("cpl_thresholds", user, current);
    saveCplThresholds(snap.data as Parameters<typeof saveCplThresholds>[0]);
    await writeAuditEntry("cpl_thresholds", user, "update", "rollback",
      { snapshot_id, snapshot_ts: snap.timestamp }, snap.data, "ALL",
      { note: note ?? "rollback", rollbackReference: snapshot_id },
    );
    return NextResponse.json({ success: true, restored_from: snap.timestamp, data: snap.data });
  }

  // ── revenue ──────────────────────────────────────────────
  if (domain === "revenue") {
    const current = readJson(REVENUE_TARGETS_FILE);
    await writeAuditSnapshot("revenue", user, current);
    writeJson(REVENUE_TARGETS_FILE, snap.data);
    await writeAuditEntry("revenue", user, "update", "rollback",
      { snapshot_id, snapshot_ts: snap.timestamp }, snap.data, "ALL",
      { note: note ?? "rollback", rollbackReference: snapshot_id },
    );
    return NextResponse.json({ success: true, restored_from: snap.timestamp, data: snap.data });
  }

  // ── kpi ──────────────────────────────────────────────────
  if (domain === "kpi") {
    const snapData = snap.data as { year: number; months: Parameters<typeof saveKpiYear>[1] } | null;
    if (!snapData?.year || !Array.isArray(snapData.months)) {
      return NextResponse.json({ error: "Snapshot KPI không hợp lệ" }, { status: 400 });
    }
    const current = {};  // kpi-store manages its own file
    await writeAuditSnapshot("kpi", user, current);
    await saveKpiYear(snapData.year, snapData.months, user.email);
    await writeAuditEntry("kpi", user, "update", `rollback_year_${snapData.year}`,
      { snapshot_id, snapshot_ts: snap.timestamp }, snapData, "ALL",
      { note: note ?? "rollback", rollbackReference: snapshot_id },
    );
    return NextResponse.json({ success: true, restored_from: snap.timestamp, data: snapData });
  }

  return NextResponse.json({ error: `Rollback chưa implement cho domain: ${domain}` }, { status: 400 });
}
