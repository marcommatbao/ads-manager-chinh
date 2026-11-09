// GET /api/cron/improvements-auto-apply
// Daily — pulls live Improvements via the same computation the human
// dashboard uses (GET /api/improvements, now also CRON_SECRET-callable —
// see that route's auth branch), and for items already flagged
// canAutoApply:true (a per-rule safety judgment hand-authored in
// app/api/improvements/route.ts's rule generators — previously dead
// metadata that nothing in the codebase ever read) either recommends
// (dry_run, default) or actually applies (auto_apply) via the exact same
// real Google/Meta mutation the human "Apply" button uses (applyOne() from
// app/api/improvements/apply/route.ts — no duplicated mutation logic).
//
// Skips IMPROVE_PMAX_ASSETS/FIX_AD_STRENGTH — their "apply" is a redirect
// stub to Creative AI Studio, not a real fix; auto-dismissing those would
// hide a task a human still needs to do by hand.
//
// Idempotency: on a successful real auto-apply, immediately dismisses the
// item (lib/improvements-store.ts) so this cron never reapplies the same
// action twice (e.g. re-adding the same negative keyword) — Improvements
// has no separate "already applied" ledger, only a dismissed-ids store, so
// dismiss-on-apply is the whole idempotency guarantee here.
//
// Execution is gated twice: the company must be in auto_apply mode, AND the
// specific action must be enabled in lib/auto-apply-settings (Settings →
// Auto-Apply). Both fall back to IMPROVEMENTS_AUTO_APPLY_MODE=dry_run when
// nothing is stored — mirrors this app's existing NBA_AUTO_APPLY /
// AB_TEST_AUTO_STOP_MODE convention rather than silently enabling autonomous
// keyword/budget mutations. Reporting is deliberately ungated: the Telegram
// digest still lists every candidate and names the gate that held it back.
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { dismissImprovement } from "@/lib/improvements-store";
import { applyOne, type ApplyPayload, type Company } from "@/app/api/improvements/apply/route";
import { sendSystemAlert } from "@/lib/system-alert";
import { recordCampaignMutation } from "@/lib/mutation-guard";
import { effectiveMode, isRuleEnabled } from "@/lib/auto-apply-settings";
import { companyIds } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Đợt 21 A6: đọc danh sách công ty LÚC CHẠY (trình thiết lập đổi data/companies.json không cần khởi động lại).

// Apply-route actions that are real mutations. IMPROVE_PMAX_ASSETS/
// FIX_AD_STRENGTH deliberately excluded (redirect stub, not a real fix)
// and RESOLVE_ALERT excluded (not an ads mutation this job should own).
const AUTO_APPLY_ACTIONS = new Set([
  "PAUSE_KEYWORD",
  "UPDATE_BUDGET",
  "UPDATE_TARGET_CPA",
  "ADD_NEGATIVE",
  "UPDATE_DEVICE_BID",
]);

interface RemoteImprovement {
  id: string;
  type: string;
  title: string;
  priority: string;
  company: string;
  status: string;
  canAutoApply: boolean;
  applyPayload?: ApplyPayload;
}

async function fetchCandidates(company: Company): Promise<RemoteImprovement[]> {
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const res = await fetch(`${base}/api/improvements?company=${company}`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  if (!res.ok) throw new Error(`GET /api/improvements?company=${company} → HTTP ${res.status}`);
  const data = (await res.json()) as { improvements?: RemoteImprovement[] };
  return (data.improvements ?? []).filter(
    (i) =>
      i.status === "ACTIVE" &&
      i.canAutoApply &&
      i.applyPayload?.action &&
      AUTO_APPLY_ACTIONS.has(i.applyPayload.action)
  );
}

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request, "cron/improvements_auto_apply");
  if (!cronAuth.ok) return cronAuth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";
  const jobGuard = await startJobRun("improvements_auto_apply", triggeredBy);
  /** Lỗi gửi thông báo — KHÔNG phải lỗi của công việc chính. */
  let notifyWarning: string | null = null;
  if (jobGuard.blocked) return jobGuard.response;

  try {
    const perCompany = await Promise.all(
      companyIds().map(async (company) => ({ company, candidates: await fetchCandidates(company) }))
    );
    const allCandidates = perCompany.flatMap((c) => c.candidates.map((i) => ({ ...i, _company: c.company })));

    const applied: { id: string; type: string; title: string; company: string }[] = [];
    const failed: { id: string; type: string; title: string; company: string; error: string }[] = [];

    // Mode and per-action toggles are now settable per company in the UI
    // (data/auto-apply-settings.json); IMPROVEMENTS_AUTO_APPLY_MODE stays the
    // fallback when nothing is stored, so existing deploys are unaffected.
    // Candidate reporting below is deliberately NOT narrowed by the toggles —
    // the digest keeps listing everything, only execution is gated.
    const willRun = (item: (typeof allCandidates)[number]) =>
      effectiveMode(item._company) === "auto_apply" &&
      isRuleEnabled(item._company, item.applyPayload?.action ?? "");

    for (const item of allCandidates) {
      if (!willRun(item)) continue;
      try {
        const result = await applyOne(item._company, item.applyPayload!);
        if (result.success) {
          await dismissImprovement(item.id, item._company);
          applied.push({ id: item.id, type: item.type, title: item.title, company: item._company });
        } else {
          failed.push({ id: item.id, type: item.type, title: item.title, company: item._company, error: result.error ?? "unknown" });
        }
      } catch (err) {
        failed.push({ id: item.id, type: item.type, title: item.title, company: item._company, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Đợt 15b: Telegram đã tắt (29/09). Chỉ báo Teams khi CÓ ghi thật (áp / thất bại) — danh sách đề xuất chạy thử mỗi ngày là nhiễu.
    for (const a of applied) {
      const item = allCandidates.find((i) => i.id === a.id)
      const cid = item?.applyPayload?.campaignId ?? item?.applyPayload?.campaignResource?.match(/campaigns\/(\d+)/)?.[1]
      if (cid) recordCampaignMutation({ source: { type: "cron_auto_apply", jobId: "improvements_auto_apply" }, event: "automation.rule_applied", company: a.company as Company, campaignId: cid, campaignName: item?.applyPayload?.campaignName ?? cid, rationale: a.title, notes: `${a.type} · ${item?.applyPayload?.action ?? ""}`, platform: "google_ads" })
    }
    if (applied.length || failed.length) {
      const sent = await sendSystemAlert({
        level: failed.length ? "danger" : "warning",
        title: `⚙️ Improvements tự áp — ${applied.length} đã ghi, ${failed.length} thất bại`,
        facts: [...applied.map((a) => ({ title: `✓ ${a.company} · ${a.type}`, value: a.title })), ...failed.map((f) => ({ title: `✕ ${f.company} · ${f.type}`, value: `${f.title} — ${f.error}` }))],
        action: "Tắt: Improvements → Tự động áp dụng. Kết quả đo lại 7/14 ngày: AdsCommand → Đã làm & kết quả.",
      }).catch((e) => ({ sent: false, error: e instanceof Error ? e.message : String(e) }))
      if (!sent.sent) notifyWarning = ("error" in sent && sent.error) || "Không gửi được thông báo Teams"
    }

    const summary =
      `candidates=${allCandidates.length}, mode=${companyIds().map((c) => `${c}:${effectiveMode(c)}`).join("/")}, ` +
      `applied=${applied.length}, failed=${failed.length}`;
    await jobGuard.finish(
      // Chỉ việc áp dụng thất bại mới là failure; gửi thông báo hỏng thì không.
      failed.length > 0 ? "failure" : "success",
      notifyWarning ? `${summary} | CẢNH BÁO: không gửi được thông báo (${notifyWarning})` : summary,
      failed.length > 0 ? new Error(failed.map((f) => `${f.id}: ${f.error}`).join("; ")) : undefined
    );

    return NextResponse.json({
      success: true,
      mode: Object.fromEntries(companyIds().map((c) => [c, effectiveMode(c)])),
      candidates: allCandidates.length,
      applied,
      failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await jobGuard.finish("failure", null, err);
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
