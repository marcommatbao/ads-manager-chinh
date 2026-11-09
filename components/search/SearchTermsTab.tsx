"use client";

// ============================================================
// Tab "🔍 Cụm tìm kiếm" — nội dung gốc của /google-search (trước Đợt 11e),
// tách ra làm một tab trong hệ thống tab mới. Logic giữ NGUYÊN so với bản cũ;
// thay đổi duy nhất: `company` nay là prop từ trang cha (một bộ chọn công ty
// dùng chung cho cả 4 tab, không mỗi tab một bộ riêng), và hai lệnh ghi
// (chặn cụm / thêm từ khoá) đi qua `useGuardedWrite` (components/ConfirmWriteDialog.tsx)
// thay vì `window.confirm()` + fetch thẳng — cùng UX Kiểm trước → gõ "XAC NHAN"
// → ghi → Hoàn tác như phần còn lại của app (xem components/GoogleAutomationTab.tsx).
// ============================================================

import { useState } from "react";
import useSWR from "swr";
import { Play, Pause, Loader2, RefreshCw, Ban, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  intentOf, addTierOf, negTierOf, ADD_TIER, NEG_TIER,
  type AddTier, type NegTier,
} from "@/lib/search-term-plan";
import { useToast } from "@/components/Toast";
import { useGuardedWrite, type GuardedCall } from "@/components/ConfirmWriteDialog";
import { useIntlLocale, useT } from "@/lib/i18n/client";

const rich = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

type Company = string;

/** Hình dạng THẬT của /api/google/campaigns — đọc từ chính route đó, không đoán.
 *  Số liệu nằm LỒNG trong `metrics`, và mảng trả về dưới khoá `data` chứ không
 *  phải `campaigns`. Bản đầu của trang này đoán cả hai chỗ nên danh sách luôn
 *  rỗng, trong khi cụm tìm kiếm bên dưới vẫn hiện đúng tên campaign — dấu hiệu
 *  rõ ràng là dữ liệu có, chỉ đọc sai chỗ. */
interface Campaign {
  id: string; name: string; status: string; objective: string;
  dailyBudget: number;
  metrics: { spend: number; clicks: number; impressions: number; conversions: number; ctr: number; cpc: number };
}
interface Term {
  searchTerm: string; campaignName: string; campaignId: string; adGroupId: string;
  clicks: number; conversions: number; cost: number;
  /** Chỉ có ở danh sách đáng chặn — API tính sẵn: chặn khớp cụm sẽ nuốt theo
   *  bao nhiêu cụm khác và bao nhiêu chuyển đổi. */
  blast?: { terms: number; conversions: number; cost: number };
}

const fmtVnd = (n: number, intl: string) => `₫${Math.round(n).toLocaleString(intl)}`;
const ymd = (d: Date) => {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const json = (u: string) => fetch(u).then(r => r.json());

// Bộ chấm điểm nằm ở lib/search-term-plan.ts — hàm thuần, tách ra để chạy thử
// được mà không cần mở trình duyệt.

export function SearchTermsTab({ company }: { company: Company }) {
  const t = useT();
  const intl = useIntlLocale();
  const vnd = (n: number) => fmtVnd(n, intl);
  const now = new Date();
  const [from, setFrom] = useState(ymd(new Date(now.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(ymd(now));

  /** Mặc định "Có hoạt động": đang chạy HOẶC có tiêu tiền trong kỳ.
   *  Tài khoản có 32 chiến dịch Search mà chỉ 3 cái chạy — mở ra là một trang
   *  toàn dòng ₫0, ba dòng đáng đọc chìm mất. Mặc định phải là thứ đáng đọc,
   *  không phải "tất cả cho đầy đủ". */
  const [filter, setFilter] = useState<"active_or_spent" | "running" | "spent" | "paused" | "all">("active_or_spent");
  const [sortBy, setSortBy] = useState<"spend" | "cpa" | "conv" | "name">("spend");

  const { data: campData, isLoading: campLoading, mutate: reloadCamps } = useSWR(
    `/api/google/campaigns?company=${company}&from=${from}&to=${to}`, json,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const { data: termData, isLoading: termLoading, mutate: reloadTerms } = useSWR(
    `/api/google/search-terms?company=${company}&days=30`, json,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const { toast } = useToast();
  const guard = useGuardedWrite();

  // CHỈ campaign Search. PMax có trang riêng và cách quản khác hẳn — trộn vào
  // đây thì mọi thao tác phải phân nhánh, và người dùng dễ sửa nhầm loại.
  const M0 = { spend: 0, clicks: 0, impressions: 0, conversions: 0, ctr: 0, cpc: 0 };
  const allSearch: Campaign[] = (campData?.data ?? []).filter(
    (c: Campaign) => /SEARCH/i.test(c.objective ?? ""),
  );

  const stat = {
    running: allSearch.filter(c => c.status === "ACTIVE").length,
    paused: allSearch.filter(c => c.status !== "ACTIVE").length,
    spent: allSearch.filter(c => (c.metrics ?? M0).spend > 0).length,
    totalSpend: allSearch.reduce((n, c) => n + (c.metrics ?? M0).spend, 0),
    totalConv: allSearch.reduce((n, c) => n + (c.metrics ?? M0).conversions, 0),
    /** Đang chạy mà KHÔNG tiêu đồng nào trong kỳ — dấu hiệu bất thường: hết
     *  ngân sách, giá thầu quá thấp, quảng cáo bị từ chối, hoặc từ khoá không
     *  ai tìm. Không tự nó là lỗi, nhưng đáng nhìn. */
    runningNoSpend: allSearch.filter(c => c.status === "ACTIVE" && (c.metrics ?? M0).spend === 0).length,
    /** Đã tạm dừng nhưng có tiêu trong kỳ = bị dừng GIỮA kỳ. */
    pausedButSpent: allSearch.filter(c => c.status !== "ACTIVE" && (c.metrics ?? M0).spend > 0).length,
  };

  const campaigns: Campaign[] = allSearch
    .filter(c => {
      const sp = (c.metrics ?? M0).spend;
      const on = c.status === "ACTIVE";
      if (filter === "running") return on;
      if (filter === "spent") return sp > 0;
      if (filter === "paused") return !on;
      if (filter === "active_or_spent") return on || sp > 0;
      return true;
    })
    .sort((a, b) => {
      const ma = a.metrics ?? M0, mb = b.metrics ?? M0;
      if (sortBy === "name") return a.name.localeCompare(b.name, "vi");
      if (sortBy === "conv") return mb.conversions - ma.conversions;
      if (sortBy === "cpa") {
        // Chưa có chuyển đổi thì KHÔNG coi là CPA vô hạn rồi đẩy xuống cuối —
        // đẩy xuống cuối là giấu mất thứ đang tiêu tiền mà chưa ra kết quả.
        const ca = ma.conversions > 0 ? ma.spend / ma.conversions : Infinity;
        const cb = mb.conversions > 0 ? mb.spend / mb.conversions : Infinity;
        if (ca === Infinity && cb === Infinity) return mb.spend - ma.spend;
        return cb === Infinity ? -1 : ca === Infinity ? 1 : cb - ca;
      }
      return mb.spend - ma.spend;
    });
  const wasted: Term[] = termData?.data?.suggestNegative ?? [];
  /** Cụm ĐÃ RA ĐƠN mà chưa có từ khoá nào phủ — nửa còn lại của cùng một API,
   *  và là nửa duy nhất làm campaign TỐT LÊN. Chặn cụm xấu chỉ ngừng lỗ; thêm
   *  cụm tốt mới là mở rộng. Bản đầu của trang này chỉ vẽ nửa chặn. */
  const toAdd: Term[] = termData?.data?.suggestAdd ?? [];
  const conflicting: string[] = termData?.data?.conflicting ?? [];
  const capHit = termData?.data?.capHit as { searchTerms?: boolean; existingKeywords?: boolean } | undefined;

  /** Gộp các dòng cùng một cụm.
   *
   *  Google trả search_term_view theo (CỤM × NHÓM QUẢNG CÁO), nên "mua tên
   *  miền" xuất hiện 2 dòng (298 nhấp và 245 nhấp) chỉ vì nó chạy ở hai nhóm.
   *  Để nguyên thì người đọc tưởng là hai cụm khác nhau và cộng nhầm. Gộp để
   *  HIỂN THỊ, nhưng giữ nguyên danh sách nhóm để lúc GHI còn biết ghi vào đâu. */
  function groupByTerm(rows: Term[]) {
    const m = new Map<string, { term: string; clicks: number; cost: number; conversions: number; places: Term[]; blast?: Term["blast"] }>();
    for (const r of rows) {
      const k = r.searchTerm.trim().toLowerCase();
      const g = m.get(k) ?? { term: r.searchTerm, clicks: 0, cost: 0, conversions: 0, places: [] as Term[] };
      g.clicks += r.clicks; g.cost += r.cost; g.conversions += r.conversions; g.places.push(r);
      // Bán kính sát thương tính theo CỤM nên mọi dòng của cùng cụm đều giống
      // nhau — lấy dòng đầu có là đủ, không cộng dồn (cộng dồn là nhân đôi).
      g.blast ??= r.blast;
      m.set(k, g);
    }
    return Array.from(m.values());
  }

  /** Mốc CPA của chính tài khoản, cùng cửa sổ 30 ngày — API tính, không đặt
   *  tay. null = kỳ này chưa có chuyển đổi nào ⇒ không xếp hạng, nói thẳng ra. */
  const benchmarkCpa: number | null = termData?.data?.benchmark?.cpa ?? null;

  /** Sắp theo TẦNG HÀNH ĐỘNG trước, rồi mới tới số liệu. Sắp theo số chuyển
   *  đổi như trước đẩy lên đầu những cụm đắt gấp nhiều lần mốc. */
  const addGroups = groupByTerm(toAdd)
    .map(g => ({ ...g, ...addTierOf(g, benchmarkCpa) }))
    .sort((a, b) => ADD_TIER[a.tier].rank - ADD_TIER[b.tier].rank || b.conversions - a.conversions);
  const negGroups = groupByTerm(wasted)
    .map(g => ({ ...g, ...negTierOf(g, conflicting, g.blast) }))
    .sort((a, b) => NEG_TIER[a.tier].rank - NEG_TIER[b.tier].rank || b.cost - a.cost);
  const isConflict = (term: string) => conflicting.includes(term.trim().toLowerCase());

  const addPlan = (Object.keys(ADD_TIER) as AddTier[])
    .map(t => ({ tier: t, rows: addGroups.filter(g => g.tier === t) }))
    .filter(x => x.rows.length > 0);
  const negPlan = (Object.keys(NEG_TIER) as NegTier[])
    .map(t => {
      const rows = negGroups.filter(g => g.tier === t);
      return { tier: t, rows, cost: rows.reduce((n, g) => n + g.cost, 0) };
    })
    .filter(x => x.rows.length > 0);

  /** Loại khớp PHỦ ĐỊNH theo từng cụm. Trước đây mọi cụm đều ghi khớp cụm —
   *  an toàn với cụm dài, nhưng với cụm gốc như "tên miền" thì chặn luôn cả
   *  danh mục sản phẩm. */
  const negMatchByTerm = new Map<string, "EXACT" | "PHRASE">(
    negGroups.map(g => [g.term.trim().toLowerCase(), g.negMatch] as const),
  );

  /** Loại khớp đề xuất theo từng cụm — dùng khi chọn chế độ "Theo đề xuất". */
  const matchByTerm = new Map<string, "EXACT" | "PHRASE">(
    addGroups.map(g => [g.term.trim().toLowerCase(), ADD_TIER[g.tier].match ?? "PHRASE"] as const),
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [negBusy, setNegBusy] = useState(false);
  const [negMsg, setNegMsg] = useState<string | null>(null);
  const [pickedAdd, setPickedAdd] = useState<Set<string>>(new Set());
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addMatch, setAddMatch] = useState<"AUTO" | "EXACT" | "PHRASE">("AUTO");

  const setErr = (id: string, msg: string | null) =>
    setRowError(prev => { const n = { ...prev }; if (msg) n[id] = msg; else delete n[id]; return n; });

  async function toggleStatus(c: Campaign) {
    const turningOn = c.status !== "ACTIVE";
    // Bật campaign = bắt đầu tiêu tiền thật. Hỏi lại một câu — thao tác này
    // không có nút hoàn tác, và tool tạo campaign ở trạng thái tạm dừng chính
    // là để bước bật lên luôn là một quyết định có ý thức.
    if (turningOn && !confirm(
      t("google.searchTerms.confirmEnable", { name: c.name, budget: vnd(c.dailyBudget) }),
    )) return;
    setBusyId(c.id); setErr(c.id, null);
    try {
      const res = await fetch(`/api/google/campaigns/${c.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: turningOn ? "ACTIVE" : "PAUSE", company }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? t("google.searchTerms.statusFailed"));
      await reloadCamps();
    } catch (e) {
      setErr(c.id, e instanceof Error ? e.message : t("google.searchTerms.unknownError"));
    } finally { setBusyId(null); }
  }

  async function saveBudget(c: Campaign) {
    const v = Number(budgetDraft[c.id]);
    if (!Number.isFinite(v) || v <= 0) { setErr(c.id, t("google.searchTerms.budgetInvalid")); return; }
    setBusyId(c.id); setErr(c.id, null);
    try {
      const res = await fetch(`/api/google/campaigns/${c.id}/budget`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyBudget: v, company }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? t("google.searchTerms.budgetFailed"));
      setBudgetDraft(prev => { const n = { ...prev }; delete n[c.id]; return n; });
      await reloadCamps();
    } catch (e) {
      setErr(c.id, e instanceof Error ? e.message : t("google.searchTerms.unknownError"));
    } finally { setBusyId(null); }
  }

  // Đợt 11e: đi qua lớp ghi an toàn dùng chung (components/ConfirmWriteDialog.tsx) —
  // Kiểm trước (validateOnly, không ghi) → hộp thoại gõ "XAC NHAN" → ghi thật →
  // toast kèm nút Hoàn tác. Route /api/google/keywords/negative đã tự Kiểm
  // trước/lưu lệnh ngược ở phía server (lib/write-guard.ts) từ Đợt 11d — ở đây
  // chỉ đổi CÁCH GỌI, không đổi route.
  async function addNegatives() {
    // Chặn ở đúng những campaign mà cụm đó tiêu tiền và KHÔNG ra đơn.
    const chosen = wasted.filter(t => picked.has(t.searchTerm.trim().toLowerCase()));
    if (chosen.length === 0) return;
    const exact = chosen.filter(t => (negMatchByTerm.get(t.searchTerm.trim().toLowerCase()) ?? "EXACT") === "EXACT").length;
    setNegBusy(true); setNegMsg(null);
    try {
      const call: GuardedCall = {
        url: "/api/google/keywords/negative",
        payload: {
          company,
          negatives: chosen.map(t => ({
            keyword: t.searchTerm,
            matchType: negMatchByTerm.get(t.searchTerm.trim().toLowerCase()) ?? "EXACT",
            campaignId: t.campaignId,
          })),
        },
        label: t("google.searchTerms.neg.label", { n: chosen.length, list: chosen.slice(0, 5).map(x => x.searchTerm).join(", ") + (chosen.length > 5 ? "…" : "") }),
      };
      await guard.run(
        [call],
        {
          title: t("google.searchTerms.neg.title", { n: chosen.length }),
          company,
          description: t("google.searchTerms.neg.desc", { exact, phrase: chosen.length - exact }),
        },
        {
          onValidateFail: (message) => setNegMsg(`❌ ${message}`),
          onSuccess: (results) => {
            const saved = chosen.reduce((s, t) => s + t.cost, 0);
            setNegMsg(t("google.searchTerms.neg.done", { n: chosen.length, saved: vnd(saved) }));
            setPicked(new Set());
            void reloadTerms();
            toast({
              title: t("google.searchTerms.neg.toast", { n: chosen.length }),
              variant: "success",
              action: guard.undoAction(company, [results[0].writeId]),
            });
          },
          onFailure: (results) => {
            setNegMsg(`❌ ${results[0].error ?? t("google.searchTerms.neg.failed")}`);
          },
        },
      );
    } finally { setNegBusy(false); }
  }

  async function addKeywords() {
    // Chọn theo CỤM, nhưng ghi vào TỪNG nhóm quảng cáo mà cụm đó đã ra đơn —
    // thêm vào nhóm nó chưa từng ra đơn là đoán, không phải dữ liệu.
    const chosen = toAdd.filter(t => pickedAdd.has(t.searchTerm.trim().toLowerCase()) && t.conversions > 0);
    if (chosen.length === 0) return;
    const conv = chosen.reduce((n, t) => n + t.conversions, 0);
    const nTerms = new Set(chosen.map(t => t.searchTerm.trim().toLowerCase())).size;
    const nGroups = new Set(chosen.map(t => t.adGroupId)).size;
    // Hai điều người bấm nút KHÔNG nhìn thấy từ giao diện, mà đều ảnh hưởng tiền:
    //  1. Chọn theo CỤM nhưng ghi theo (cụm × nhóm quảng cáo) — 1 cụm ở 3 nhóm
    //     là 3 từ khoá. Người dùng chọn 1 dòng rồi thấy báo "3/3" sẽ tưởng lỗi.
    //  2. Server ghi CẢ LÔ đã chọn trong MỘT lệnh nguyên khối (lib/write-guard.ts
    //     guardedMutate — không bật partial_failure). Một từ khoá bị Google từ
    //     chối — hay gặp nhất là trùng với từ khoá đang TẠM DỪNG, thứ mà bộ lọc
    //     "đã có từ khoá phủ" không thấy vì nó chỉ đọc từ khoá ENABLED — sẽ làm
    //     CẢ LÔ trượt, không chỉ nhóm chứa nó. Càng chọn nhiều, xác suất dính
    //     càng cao — đây là lý do thật để chia đợt nhỏ.
    //  3. Từ khoá tạo ra KHÔNG kèm giá thầu (ops không đặt cpc_bid_micros), nên
    //     nó ăn theo giá mặc định của nhóm. Tiêu đề khối này hứa "thêm vào để
    //     chủ động ra giá" — chủ động được, nhưng phải tự vào Google Ads đặt.
    setAddBusy(true); setAddMsg(null);
    try {
      const call: GuardedCall = {
        url: "/api/google/keywords/add",
        payload: {
          company,
          keywords: chosen.map(t => ({
            keyword: t.searchTerm,
            // "Theo đề xuất": khớp chính xác cho cụm đã đủ bằng chứng (khoá lại
            // cụm đang thắng), khớp cụm cho cụm mới chỉ đáng thử.
            matchType: addMatch === "AUTO"
              ? (matchByTerm.get(t.searchTerm.trim().toLowerCase()) ?? "PHRASE")
              : addMatch,
            adGroupId: t.adGroupId,
          })),
        },
        label: t("google.searchTerms.add.label", { terms: nTerms, kw: chosen.length, groups: nGroups }),
      };
      await guard.run(
        [call],
        {
          title: t("google.searchTerms.add.title", { terms: nTerms, kw: chosen.length, groups: nGroups }),
          company,
          description: t("google.searchTerms.add.desc", {
            match: addMatch === "AUTO" ? t("google.searchTerms.add.matchAuto") : addMatch === "EXACT" ? t("google.searchTerms.add.matchExact") : t("google.searchTerms.add.matchPhrase"),
            conv: conv.toFixed(1),
          }),
        },
        {
          onValidateFail: (message) => setAddMsg(`❌ ${message}`),
          onSuccess: (results) => {
            const data = results[0].raw;
            // API trả kết quả TỪNG từ khoá — có thể thành công một phần. Báo
            // đúng con số thật, không nói "đã thêm N" khi chỉ N-2 cái vào được.
            const rawResults = Array.isArray(data.results) ? data.results as { success: boolean; keyword: string; error?: string }[] : [];
            const ok = rawResults.length ? rawResults.filter(r => r.success).length : chosen.length;
            const failed = rawResults.filter(r => !r.success);
            setAddMsg(
              t("google.searchTerms.add.done", { ok, total: chosen.length }) +
              (failed.length > 0 ? t("google.searchTerms.add.someFailed", { list: failed.map(r => `${r.keyword} (${r.error ?? "?"})`).join(" · ") }) : ""),
            );
            setPickedAdd(new Set());
            void reloadTerms();
            toast({
              title: t("google.searchTerms.add.toast", { ok, total: chosen.length }),
              variant: failed.length ? "error" : "success",
              action: guard.undoAction(company, [results[0].writeId]),
            });
          },
          onFailure: (results) => {
            setAddMsg(`❌ ${results[0].error ?? t("google.searchTerms.add.failed")}`);
          },
        },
      );
    } finally { setAddBusy(false); }
  }

  const totalWaste = wasted.reduce((s, t) => s + t.cost, 0);
  const pickedWaste = negGroups.filter(g => picked.has(g.term.trim().toLowerCase())).reduce((s, g) => s + g.cost, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-500 max-w-2xl">
          {rich(t("google.searchTerms.intro", { from, to }))}
        </p>
        <div className="flex items-center gap-2">
          {/* Nút khoảng ngày nhanh — số liệu Google đổi hẳn theo kỳ, mà mở
              lịch chọn tay mỗi lần thì không ai đổi kỳ nữa. */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {([[7, t("google.searchTerms.range7")], [30, t("google.searchTerms.range30")], [90, t("google.searchTerms.range90")]] as const).map(([d, label]) => {
              const f = ymd(new Date(Date.now() - (d - 1) * 86400000));
              const active = from === f && to === ymd(new Date());
              return (
                <button key={d} onClick={() => { setFrom(f); setTo(ymd(new Date())); }}
                  className={cn("px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    active ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                  {label}
                </button>
              );
            })}
          </div>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />

          <button onClick={() => { void reloadCamps(); void reloadTerms(); }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", (campLoading || termLoading) && "animate-spin")} /> {t("google.searchTerms.reload")}
          </button>
        </div>
      </div>

      {/* ── Campaign ── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-slate-800">
              {t("google.searchTerms.campaignsTitle")}<b className="text-slate-900">{campaigns.length}</b>/{allSearch.length}
            </h2>
            {campLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>

          {/* Tổng hợp kỳ: trả lời ngay "đang mở bao nhiêu, tiêu bao nhiêu" mà
              không phải tự cộng từng dòng. */}
          {allSearch.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <b className="text-slate-800">{stat.running}</b> <span className="text-slate-500">{t("google.searchTerms.running")}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                <b className="text-slate-700">{stat.paused}</b> <span className="text-slate-500">{t("google.searchTerms.paused")}</span>
              </span>
              <span className="text-slate-500">{t("google.searchTerms.spendInRange")} <b className="text-slate-900">{vnd(stat.totalSpend)}</b></span>
              <span className="text-slate-500"><b className="text-slate-900">{stat.totalConv.toFixed(1)}</b> {t("google.searchTerms.conversions")}</span>
              <span className="text-slate-500">
                {stat.totalConv > 0
                  ? <>{t("google.searchTerms.average")} <b className="text-slate-900">{vnd(stat.totalSpend / stat.totalConv)}</b>{t("google.searchTerms.perConv")}</>
                  : <i>{t("google.searchTerms.noConvInRange")}</i>}
              </span>
            </div>
          )}

          {/* Hai bất thường đáng nhìn — không tự nó là lỗi, nhưng nếu không nói
              ra thì phải soi từng dòng mới thấy. */}
          {(stat.runningNoSpend > 0 || stat.pausedButSpent > 0) && (
            <div className="flex flex-wrap gap-2 text-[10px]">
              {stat.runningNoSpend > 0 && (
                <span className="rounded bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1">
                  {rich(t("google.searchTerms.runningNoSpend", { n: stat.runningNoSpend }))}
                </span>
              )}
              {stat.pausedButSpent > 0 && (
                <span className="rounded bg-slate-50 border border-slate-200 text-slate-600 px-2 py-1">
                  {rich(t("google.searchTerms.pausedButSpent", { n: stat.pausedButSpent }))}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {([
                ["active_or_spent", t("google.searchTerms.filter.activeOrSpent", { n: allSearch.filter(c => c.status === "ACTIVE" || (c.metrics ?? M0).spend > 0).length })],
                ["running", t("google.searchTerms.filter.running", { n: stat.running })],
                ["spent", t("google.searchTerms.filter.spent", { n: stat.spent })],
                ["paused", t("google.searchTerms.filter.paused", { n: stat.paused })],
                ["all", t("google.searchTerms.filter.all", { n: allSearch.length })],
              ] as const).map(([v, label]) => (
                <button key={v} onClick={() => setFilter(v)}
                  className={cn("px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    filter === v ? "bg-red-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                  {label}
                </button>
              ))}
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="text-[11px] border border-slate-200 rounded-lg px-2 py-1 text-slate-600">
              <option value="spend">{t("google.searchTerms.sort.spend")}</option>
              <option value="cpa">{t("google.searchTerms.sort.cpa")}</option>
              <option value="conv">{t("google.searchTerms.sort.conv")}</option>
              <option value="name">{t("google.searchTerms.sort.name")}</option>
            </select>
          </div>
        </div>

        {/* Danh sách rỗng có HAI nguyên nhân hoàn toàn khác nhau: tài khoản
            thật sự chưa có campaign Search, hay lời gọi API hỏng. Hiện chung
            một câu là biến lỗi thành "tài khoản trống" — đúng cái đã xảy ra ở
            bản đầu, khi trang báo (0) trong lúc campaign vẫn đang chạy. */}
        {!campLoading && campaigns.length === 0 && campData?.success === false && (
          <p className="px-5 py-6 text-sm text-red-700">
            {rich(t("google.searchTerms.campaignsReadFailed", { error: campData?.error ?? t("google.searchTerms.unknownErrorLower") }))}
          </p>
        )}
        {!campLoading && campaigns.length === 0 && campData?.success !== false && (
          <p className="px-5 py-6 text-sm text-slate-500">
            {rich(t("google.searchTerms.noSearch", { company }))}
            {Array.isArray(campData?.data) && campData.data.length > 0 && (
              <>{t("google.searchTerms.noSearchOther", { n: campData.data.length })}</>
            )}
            {rich(t("google.searchTerms.createNew"))}
          </p>
        )}

        <div className="divide-y divide-slate-100">
          {campaigns.map(c => {
            const m = c.metrics ?? { spend: 0, clicks: 0, impressions: 0, conversions: 0, ctr: 0, cpc: 0 };
            const cpa = m.conversions > 0 ? m.spend / m.conversions : null;
            const editing = budgetDraft[c.id] !== undefined;
            const busy = busyId === c.id;
            return (
              <div key={c.id} className="px-5 py-3 space-y-2">
                <div className="flex items-start gap-3 flex-wrap">
                  <span className={cn("mt-1 h-2 w-2 rounded-full shrink-0",
                    c.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-300")} />
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                      <span>{c.status === "ACTIVE" ? t("google.searchTerms.statusRunning") : t("google.searchTerms.statusPaused")} · ID {c.id}</span>
                      {c.status === "ACTIVE" && m.spend === 0 && (
                        <span className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 font-semibold"
                          title={t("google.searchTerms.onNoSpendTitle")}>{t("google.searchTerms.onNoSpend")}</span>
                      )}
                      {c.status !== "ACTIVE" && m.spend > 0 && (
                        <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 font-semibold"
                          title={t("google.searchTerms.stoppedMidTitle")}>{t("google.searchTerms.stoppedMid")}</span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-slate-600">
                    <span title={t("google.searchTerms.costRange", { from, to })}>
                      {vnd(m.spend)}
                      {stat.totalSpend > 0 && m.spend > 0 && (
                        <span className="text-slate-400"> ({Math.round(m.spend / stat.totalSpend * 100)}%)</span>
                      )}
                    </span>
                    <span>{m.clicks.toLocaleString(intl)} {t("google.searchTerms.clicksWord")}</span>
                    <span className="text-slate-400" title={t("google.searchTerms.ctrCpcTitle")}>
                      {m.impressions > 0 ? `${m.ctr.toFixed(1)}%` : "—"} · {m.clicks > 0 ? vnd(m.cpc) : "—"}
                    </span>
                    <span>{m.conversions.toFixed(1)} {t("google.searchTerms.convShort")}</span>
                    {/* Chưa có chuyển đổi thì KHÔNG in "₫0" — 0 bị đọc thành
                        "miễn phí", trong khi sự thật là chưa đo được. */}
                    <span className={cn("font-semibold", cpa === null && "text-slate-400 italic")}>
                      {cpa === null ? t("google.searchTerms.noConvShort") : `${vnd(cpa)}${t("google.searchTerms.perConv")}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {editing ? (
                      <>
                        <input type="number" autoFocus value={budgetDraft[c.id]}
                          onChange={e => setBudgetDraft(p => ({ ...p, [c.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") void saveBudget(c); if (e.key === "Escape") setBudgetDraft(p => { const n = { ...p }; delete n[c.id]; return n; }); }}
                          className="w-28 rounded border border-blue-400 px-2 py-1 text-xs outline-none" />
                        <button onClick={() => void saveBudget(c)} disabled={busy}
                          className="rounded bg-slate-800 text-white px-2 py-1 text-[11px] font-semibold disabled:opacity-50">
                          {busy ? "..." : t("google.searchTerms.save")}
                        </button>
                        <button onClick={() => setBudgetDraft(p => { const n = { ...p }; delete n[c.id]; return n; })}
                          className="text-[11px] text-slate-400 px-1">{t("google.searchTerms.cancel")}</button>
                      </>
                    ) : (
                      <button onClick={() => setBudgetDraft(p => ({ ...p, [c.id]: String(c.dailyBudget) }))}
                        className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                        title={t("google.searchTerms.changeBudgetTitle")}>
                        {t("google.searchTerms.budgetPerDayEdit", { amount: vnd(c.dailyBudget) })}
                      </button>
                    )}

                    <button onClick={() => void toggleStatus(c)} disabled={busy}
                      className={cn("rounded px-2.5 py-1 text-[11px] font-bold flex items-center gap-1 disabled:opacity-50",
                        c.status === "ACTIVE"
                          ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          : "bg-emerald-600 text-white hover:bg-emerald-700")}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" />
                        : c.status === "ACTIVE" ? <><Pause className="h-3 w-3" /> {t("google.searchTerms.pause")}</>
                        : <><Play className="h-3 w-3" /> {t("google.searchTerms.enable")}</>}
                    </button>
                  </div>
                </div>
                {rowError[c.id] && <p className="text-[11px] text-red-600 pl-5">❌ {rowError[c.id]}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Cụm nên THÊM làm từ khoá ──
          Đặt TRƯỚC khối chặn có chủ ý: chặn cụm xấu chỉ ngừng lỗ, thêm cụm tốt
          mới là mở rộng. Thứ tự trên màn hình là thứ tự ưu tiên. */}
      <div className="rounded-xl border border-emerald-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-emerald-100 bg-emerald-50/40">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-600" /> {t("google.searchTerms.add.heading", { n: addGroups.length })}
          </h2>
          <p className="text-[11px] text-slate-600 mt-0.5">
            {rich(t("google.searchTerms.add.explain"))}
          </p>
        </div>

        {/* Kế hoạch — biến 138 dòng thành 4 quyết định. Danh sách trần không
            trả lời được "thêm cái nào"; xếp tầng thì trả lời được. */}
        {!termLoading && addGroups.length > 0 && (
          <div className="mx-5 mt-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-3">
            <p className="text-[11px] font-bold text-slate-800">
              {t("google.searchTerms.nextSteps")}
              {benchmarkCpa !== null ? (
                <span className="font-normal text-slate-500"
                  title={t("google.searchTerms.benchTitle")}>
                  {" "}{t("google.searchTerms.benchPrefix")}{" "}
                  <b className="text-slate-700">{vnd(benchmarkCpa)}</b>{t("google.searchTerms.perConversion")}
                </span>
              ) : (
                <span className="font-normal text-amber-700">
                  {" "}{rich(t("google.searchTerms.noBench"))}
                </span>
              )}
            </p>
            <div className="mt-2 space-y-1">
              {addPlan.map(x => (
                <div key={x.tier} className="flex items-start gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 w-32", ADD_TIER[x.tier].cls)}>
                    {ADD_TIER[x.tier].label} · {x.rows.length}
                  </span>
                  <span className="text-[11px] text-slate-600">{ADD_TIER[x.tier].desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chạm trần truy vấn = danh sách "đã có từ khoá phủ" bị thiếu ⇒ tool sẽ
            gợi ý thêm những từ khoá ĐANG CHẠY. Cắt cụt trong im lặng là để
            người dùng tin vào một danh sách không đầy đủ. */}
        {capHit?.existingKeywords && (
          <p className="mx-5 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            {rich(t("google.searchTerms.capKeywords"))}
          </p>
        )}
        {capHit?.searchTerms && (
          <p className="mx-5 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            {rich(t("google.searchTerms.capTerms"))}
          </p>
        )}
        {conflicting.length > 0 && (
          <p className="mx-5 mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            {rich(t("google.searchTerms.conflicting", { n: conflicting.length }))}
          </p>
        )}

        {termLoading && <p className="px-5 py-4 text-sm text-slate-400">{t("google.searchTerms.loading")}</p>}
        {!termLoading && addGroups.length === 0 && (
          <p className="px-5 py-4 text-sm text-slate-500">
            {t("google.searchTerms.add.none")}
          </p>
        )}

        {addGroups.length > 0 && (
          <>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
              {addGroups.map(g => {
                const key = g.term.trim().toLowerCase();
                return (
                <label key={key}
                  className="flex items-center gap-3 px-5 py-2 text-xs hover:bg-emerald-50/40 cursor-pointer">
                  <input type="checkbox" checked={pickedAdd.has(key)}
                    onChange={() => setPickedAdd(prev => {
                      const n = new Set(prev);
                      if (n.has(key)) n.delete(key); else n.add(key);
                      return n;
                    })} />
                  <span className="flex-1 text-slate-700">{g.term}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0", ADD_TIER[g.tier].cls)}
                    title={g.why}>
                    {ADD_TIER[g.tier].label}
                  </span>
                  {(() => {
                    const it = intentOf(g.term);
                    if (it.key === "other") return null;
                    return (
                      <span className="rounded bg-slate-100 text-slate-500 px-1.5 py-0.5 text-[9px] font-bold shrink-0">
                        {it.label}
                      </span>
                    );
                  })()}
                  {isConflict(g.term) && (
                    <span className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-bold shrink-0"
                      title={t("google.searchTerms.alsoBlockTitle")}>
                      {t("google.searchTerms.alsoBlock")}
                    </span>
                  )}
                  <span className="text-slate-400 shrink-0" title={g.places.map(p => p.campaignName).join(" · ")}>
                    {g.places.length > 1 ? t("google.searchTerms.adGroupsShort", { n: g.places.length }) : g.places[0]?.campaignName?.slice(0, 22)}
                  </span>
                  <span className="text-slate-500 w-16 text-right">{g.clicks} {t("google.searchTerms.clicksWord")}</span>
                  <span className="font-bold text-emerald-700 w-20 text-right">{g.conversions.toFixed(1)} {t("google.searchTerms.convShort")}</span>
                  <span className="text-slate-500 w-24 text-right">
                    {g.conversions > 0 ? `${vnd(g.cost / g.conversions)}${t("google.searchTerms.perConv")}` : "—"}
                  </span>
                </label>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[11px] text-slate-500">
                  {pickedAdd.size > 0
                    ? <>{rich(t("google.searchTerms.add.selected", { n: pickedAdd.size }))}{" "}
                        <b className="text-emerald-700">
                          {addGroups.filter(g => pickedAdd.has(g.term.trim().toLowerCase())).reduce((n, g) => n + g.conversions, 0).toFixed(1)}
                        </b>{t("google.searchTerms.add.selectedConv")}</>
                    : t("google.searchTerms.add.pick")}
                </p>
                <div className="flex rounded border border-slate-200 overflow-hidden">
                  {(["AUTO", "PHRASE", "EXACT"] as const).map(m => (
                    <button key={m} onClick={() => setAddMatch(m)}
                      className={cn("px-2 py-0.5 text-[10px] font-bold",
                        addMatch === m ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}
                      title={m === "AUTO" ? t("google.searchTerms.add.autoTitle")
                        : m === "PHRASE" ? t("google.searchTerms.add.phraseTitle")
                        : t("google.searchTerms.add.exactTitle")}>
                      {m === "AUTO" ? t("google.searchTerms.add.autoBtn") : m === "PHRASE" ? t("google.searchTerms.add.phraseBtn") : t("google.searchTerms.add.exactBtn")}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => void addKeywords()} disabled={addBusy || pickedAdd.size === 0}
                className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1.5">
                {addBusy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("google.searchTerms.writing")}</> : <>{t("google.searchTerms.add.btn", { n: pickedAdd.size > 0 ? pickedAdd.size : "" })}</>}
              </button>
            </div>
            {pickedAdd.size > 20 && (
              <p className="mx-5 mb-2 rounded bg-red-50 border border-red-200 text-red-900 px-2.5 py-1.5 text-[11px]">
                {rich(t("google.searchTerms.add.bigBatch", { n: pickedAdd.size }))}
              </p>
            )}
            {(() => {
              // Cùng nguyên tắc với cảnh báo "ý định mua" ở bảng chặn: công cụ
              // không khoá tay người dùng, nhưng phải nói ra khi lựa chọn đi
              // ngược lại chính dữ liệu nó vừa đọc.
              const bad = addGroups.filter(g => pickedAdd.has(g.term.trim().toLowerCase())
                && (g.tier === "avoid" || g.tier === "weak"));
              if (bad.length === 0) return null;
              return (
                <p className="mx-5 mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-1.5 text-[11px]">
                  {rich(t("google.searchTerms.add.badTier", { n: bad.length, list: bad.slice(0, 5).map(r => `"${r.term}"`).join(", ") + (bad.length > 5 ? t("google.searchTerms.andMore", { n: bad.length - 5 }) : ""), why: bad[0].why }))}
                </p>
              );
            })()}
            {addMsg && <p className="px-5 pb-3 text-[11px]">{addMsg}</p>}
          </>
        )}
      </div>

      {/* ── Cụm tìm kiếm đốt tiền ── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-500" /> {t("google.searchTerms.neg.heading", { n: negGroups.length })}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {t("google.searchTerms.neg.explain1")}
            {t("google.searchTerms.neg.total")} <b className="text-red-600">{vnd(totalWaste)}</b> {rich(t("google.searchTerms.neg.explain2"))}
          </p>
        </div>

        {/* Chia tiền lãng phí thành 3 việc khác nhau. Trước đây cả 51 dòng nằm
            chung một rổ "đốt tiền" nên trông như đều chặn được — trong đó có cả
            tên thương hiệu của chính mình. */}
        {!termLoading && negGroups.length > 0 && (
          <div className="mx-5 mt-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-3">
            <p className="text-[11px] font-bold text-slate-800">{t("google.searchTerms.nextSteps")}</p>
            <div className="mt-2 space-y-1.5">
              {negPlan.map(x => (
                <div key={x.tier} className="flex items-start gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 w-36", NEG_TIER[x.tier].cls)}>
                    {NEG_TIER[x.tier].label} · {x.rows.length}
                  </span>
                  <span className="text-[11px] text-slate-600">
                    <b className={x.tier === "dont_block" ? "text-sky-700" : "text-red-600"}>{vnd(x.cost)}</b>
                    {x.tier === "block_now" && (
                      <span className="text-slate-500"> {t("google.searchTerms.neg.yearly", { amount: vnd(x.cost * 12) })}</span>
                    )}
                    {x.tier === "dont_block" && <span className="text-slate-500"> {t("google.searchTerms.neg.dontBlock")}</span>}
                    {x.tier === "block_scoped" && <span className="text-slate-500"> {t("google.searchTerms.neg.per30")}</span>}
                    {" — "}{NEG_TIER[x.tier].desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {termLoading && <p className="px-5 py-4 text-sm text-slate-400">{t("google.searchTerms.loading")}</p>}
        {!termLoading && negGroups.length === 0 && (
          <p className="px-5 py-4 text-sm text-slate-500">
            {t("google.searchTerms.neg.none")}
          </p>
        )}

        {negGroups.length > 0 && (
          <>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
              {negGroups.map(g => {
                const key = g.term.trim().toLowerCase();
                return (
                <label key={key}
                  className="flex items-center gap-3 px-5 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={picked.has(key)}
                    onChange={() => setPicked(prev => {
                      const n = new Set(prev);
                      if (n.has(key)) n.delete(key); else n.add(key);
                      return n;
                    })} />
                  <span className="flex-1 text-slate-700">{g.term}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0", NEG_TIER[g.tier].cls)}
                    title={g.why}>
                    {NEG_TIER[g.tier].label}
                  </span>
                  {isConflict(g.term) && (
                    <span className="rounded bg-red-100 text-red-800 px-1.5 py-0.5 text-[9px] font-bold shrink-0"
                      title={t("google.searchTerms.neg.convElsewhereTitle")}>
                      {t("google.searchTerms.neg.convElsewhere")}
                    </span>
                  )}
                  {(() => {
                    const it = intentOf(g.term);
                    return (
                      <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0",
                        it.safe ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-800")}
                        title={it.safe ? t("google.searchTerms.neg.safeTitle")
                          : t("google.searchTerms.neg.riskyTitle")}>
                        {it.label}
                      </span>
                    );
                  })()}
                  <span className="text-slate-400 shrink-0" title={g.places.map(p => p.campaignName).join(" · ")}>
                    {g.places.length > 1 ? t("google.searchTerms.adGroupsShort", { n: g.places.length }) : g.places[0]?.campaignName?.slice(0, 22)}
                  </span>
                  <span className="text-slate-500 w-16 text-right">{g.clicks} {t("google.searchTerms.clicksWord")}</span>
                  <span className="font-semibold text-red-600 w-24 text-right">{vnd(g.cost)}</span>
                </label>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-slate-500 space-y-1">
                <p>
                  {picked.size > 0
                    ? <>{rich(t("google.searchTerms.neg.selected1", { n: picked.size }))} <b className="text-red-600">{vnd(pickedWaste)}</b>{t("google.searchTerms.neg.selected2")}</>
                    : t("google.searchTerms.neg.pick")}
                </p>
                {(() => {
                  const risky = negGroups.filter(g => picked.has(g.term.trim().toLowerCase()) && !intentOf(g.term).safe);
                  if (risky.length === 0) return null;
                  return (
                    <p className="rounded bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1 max-w-xl">
                      {rich(t("google.searchTerms.neg.riskyBox", { n: risky.length, list: risky.map(r => `"${r.term}"`).join(", ") }))}
                    </p>
                  );
                })()}
              </div>
              <button onClick={() => void addNegatives()} disabled={negBusy || picked.size === 0}
                className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-red-700 disabled:opacity-40 flex items-center gap-1.5">
                {negBusy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("google.searchTerms.writing")}</> : <>{t("google.searchTerms.neg.btn", { n: picked.size > 0 ? picked.size : "" })}</>}
              </button>
            </div>
            {negMsg && <p className="px-5 pb-3 text-[11px]">{negMsg}</p>}
          </>
        )}
      </div>

      {guard.dialog}
    </div>
  );
}
