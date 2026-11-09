"use client";

// ============================================================
// CompanyPnL — Chi phí QC × Doanh thu/Đơn theo công ty (MBC/MBI)
// Nguồn: /api/finance/company-pnl. MBC đo doanh thu, MBI đo đơn hàng.
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { DollarSign, RefreshCw, AlertTriangle, TrendingUp, ShoppingCart, Percent, Calendar, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BUILTIN_AD_CHANNELS, OTHER_CHANNEL, channelLabel, type AdChannelDef } from "@/lib/settings/ad-channels-def";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

/** Kênh đặt được trần ngân sách (Settings → KPI) — lấy từ sổ kênh dùng chung (`channels` của GET /api/settings/kpi). */
type ChannelBudget = Record<string, number>;
type ChannelSpend = Record<string, number>;

interface MbcPnl {
  company: "MBC";
  spendGoogle: number; spendFacebook: number; totalSpend: number;
  /** 12/10: đối tác hỗ trợ + chi phí thật (= tổng − hỗ trợ). Thiếu ở payload cũ trong bộ đệm → coi như 0. */
  partnerSupport?: number; netSpend?: number;
  spendByChannel?: ChannelSpend;
  spendFacebookError?: string | null; spendGoogleError?: string | null;
  spendFacebookStaleAt?: string | null;
  revenue: number; orders: number; aov: number; costPerOrder: number;
  adCostRatioPct: number; projectedRevenue: number;
  // true khi Report API (count-revenue) lỗi/timeout — các số ở trên đã bị
  // coerce về 0, KHÔNG phải doanh thu thật bằng 0.
  revenueSourceError?: boolean;
}
interface MbiPnl {
  company: "MBI";
  spendGoogle: number; spendFacebook: number; totalSpend: number;
  /** 12/10: đối tác hỗ trợ + chi phí thật (= tổng − hỗ trợ). Thiếu ở payload cũ trong bộ đệm → coi như 0. */
  partnerSupport?: number; netSpend?: number;
  spendByChannel?: ChannelSpend;
  spendFacebookError?: string | null; spendGoogleError?: string | null;
  spendFacebookStaleAt?: string | null;
  orders: number; costPerOrder: number; projectedOrders: number;
  // true khi Report API (count-sale-order-paid) lỗi/timeout — orders ở trên
  // đã bị coerce về 0, KHÔNG phải đơn hàng thật bằng 0.
  ordersSourceError?: boolean;
}
interface PeriodTargets {
  revenueMbc: number; adSpendMbc: number; adSpendMbi: number; ordersMbi: number;
  adSpendMbcByChannel?: ChannelBudget; adSpendMbiByChannel?: ChannelBudget;
  /** true = số SUY RA từ KPI tháng, không phải mục tiêu ai đó đặt cho kỳ này. */
  derived: boolean;
  derivedNote: string | null;
}
interface MetricDelta {
  current: number; previous: number; diff: number;
  /** null = không tính được nghĩa (xem noBaseline/lowBaseline). */
  pct: number | null;
  noBaseline: boolean; lowBaseline: boolean; clamped: boolean;
}
interface PnlComparison {
  label: string; comparedDays: number; truncated: boolean;
  MBC: { totalSpend: MetricDelta; revenue: MetricDelta; orders: MetricDelta };
  MBI: { totalSpend: MetricDelta; orders: MetricDelta };
}
interface ApiResponse {
  success: boolean;
  month: string;
  daysElapsed: number; daysInMonth: number;
  mode?: "month" | "week" | "rolling28";
  periodKey?: string;
  periodLabel?: string;
  targets?: PeriodTargets;
  /** true = chi phí TikTok/Zalo nhập tay KHÔNG nằm trong tổng chi phí kỳ này. */
  manualExcluded?: boolean;
  comparison?: PnlComparison;
  companies: { MBC?: MbcPnl; MBI?: MbiPnl };
  error?: string;
}

// Số đầy đủ (không rút gọn), chuẩn theo ngôn ngữ đang chọn (vi-VN: 123.456.789đ) + hậu tố đ.
function makeFmt(loc: string) {
  return {
    fmtVND: (v: number): string => `${Math.round(v).toLocaleString(loc)}đ`,
    fmtNum: (v: number): string => v.toLocaleString(loc),
  };
}
// Chuỗi từ điển có <strong>…</strong> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string, cls?: string): React.ReactNode[] {
  return s.split(/<strong>(.*?)<\/strong>/).map((part, i) => (i % 2 ? <strong key={i} className={cls}>{part}</strong> : part));
}
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Thứ Hai của tuần chứa `d` — tuần Việt Nam: T2 → CN. */
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay();
  out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1));
  return out;
}
function currentWeek(): string { return ymd(mondayOf(new Date())); }

export default function CompanyPnL() {
  const t = useT();
  const [mode, setMode] = useState<"month" | "week" | "rolling28">("month");
  const [month, setMonth] = useState(currentMonth());
  const [week, setWeek] = useState(currentWeek());
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [kpi, setKpi] = useState<{
    adSpendMbc: number; adSpendMbi: number; revenueMbc: number; ordersMbi: number;
    mbcByChannel?: ChannelBudget; mbiByChannel?: ChannelBudget;
  } | null>(null);
  const [channels, setChannels] = useState<AdChannelDef[]>(BUILTIN_AD_CHANNELS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const cmp = compare ? "&compare=1" : "";
      const res = await fetch(
        mode === "rolling28"
          ? `/api/finance/company-pnl?rolling=1${cmp}`
          : mode === "week"
          ? `/api/finance/company-pnl?week=${week}${cmp}`
          : `/api/finance/company-pnl?month=${month}${cmp}`,
      );
      const text = await res.text();
      const json = (text ? JSON.parse(text) : {}) as ApiResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? t("overview.pnl.loadError", { status: res.status }));
      setData(json);
      if (mode !== "month") {
        // Chế độ tuần: mục tiêu do server chia đều theo ngày (xử lý đúng cả tuần
        // vắt qua hai tháng/hai năm) — không tự cộng ở trình duyệt.
        setKpi(json.targets
          ? { adSpendMbc: json.targets.adSpendMbc, adSpendMbi: json.targets.adSpendMbi,
              revenueMbc: json.targets.revenueMbc, ordersMbi: json.targets.ordersMbi,
              mbcByChannel: json.targets.adSpendMbcByChannel,
              mbiByChannel: json.targets.adSpendMbiByChannel }
          : null);
        return;
      }
      // KPI ngân sách QC tháng này
      try {
        const y = month.slice(0, 4); const mi = Number(month.slice(5, 7)) - 1;
        const kr = await fetch(`/api/settings/kpi?year=${y}`);
        const kt = await kr.text(); const kj = kt ? JSON.parse(kt) : {};
        if (kj.success && Array.isArray(kj.channels) && kj.channels.length > 0) setChannels(kj.channels);
        // 12/10: trần THỰC TẾ (cố định + khoản chi bổ sung của tháng).
        const mk = kj.success && Array.isArray(kj.effectiveMonths) ? kj.effectiveMonths[mi] : kj.success && Array.isArray(kj.months) ? kj.months[mi] : null;
        setKpi(mk ? {
          adSpendMbc: mk.adSpendMbc || 0, adSpendMbi: mk.adSpendMbi || 0,
          revenueMbc: mk.revenueMbc || 0, ordersMbi: mk.ordersMbi || 0,
          mbcByChannel: mk.adSpendMbcByChannel, mbiByChannel: mk.adSpendMbiByChannel,
        } : null);
      } catch { setKpi(null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("overview.pnl.connError"));
    } finally { setLoading(false); }
  }, [mode, month, week, compare, t]);

  useEffect(() => { load(); }, [load]);

  const mbc = data?.companies.MBC;
  const mbi = data?.companies.MBI;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="rounded-full bg-emerald-50 p-2"><DollarSign className="h-4 w-4 text-emerald-600" /></div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-800">{t("overview.pnl.title")}</h2>
          <p className="text-[11px] text-slate-400">
            {t("overview.pnl.subtitle")}
            {data ? ` · ${data.periodLabel ?? ""}${data.periodLabel ? " · " : ""}${t("overview.pnl.daysElapsed", { elapsed: data.daysElapsed, total: data.daysInMonth })}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            {([
              { k: "month", label: "overview.pnl.mode.month", hint: "overview.pnl.mode.monthHint" },
              { k: "week", label: "overview.pnl.mode.week", hint: "overview.pnl.mode.weekHint" },
              { k: "rolling28", label: "overview.pnl.mode.rolling28", hint: "overview.pnl.mode.rolling28Hint" },
            ] as const).map(m => (
              <button key={m.k} onClick={() => setMode(m.k)} title={t(m.hint)}
                className={cn("px-2.5 py-1.5 transition-colors",
                  mode === m.k ? "bg-amber-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>
                {t(m.label)}
              </button>
            ))}
          </div>
          <button onClick={() => setCompare(v => !v)}
            title={t("overview.pnl.compare.hint")}
            className={cn("px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors",
              compare ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")}>
            {t("overview.pnl.compare.btn")}
          </button>
          {mode !== "rolling28" && <Calendar className="h-3.5 w-3.5 text-slate-400" />}
          {mode === "rolling28" ? null : mode === "week" ? (
            // Chọn ngày bất kỳ trong tuần; server tự quy về thứ Hai. `max` chặn
            // tuần tương lai — kỳ chưa xảy ra thì không có số để đo, hiện ra sẽ
            // là một loạt số 0 trông như "tuần đó không chi đồng nào".
            <input type="date" value={week} max={ymd(new Date())}
              onChange={e => e.target.value && setWeek(ymd(mondayOf(new Date(`${e.target.value}T00:00:00`))))}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-400" />
          ) : (
            <input type="month" value={month} max={currentMonth()} onChange={e => setMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-400" />
          )}
          <button onClick={load} disabled={loading} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 disabled:opacity-50" aria-label={t("overview.pnl.refresh")}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {mode === "rolling28" && (
        // Người dùng sẽ thấy số ở chế độ này lệch với chế độ Tháng và thắc mắc.
        // Nói trước lý do: cố ý bỏ hôm nay để hai kỳ đều là ngày trọn.
        <p className="mb-3 rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 text-[10px] text-indigo-700">
          {rich(t("overview.pnl.rolling.note"))}
        </p>
      )}

      {compare && data?.comparison && (
        // Nói rõ đang so với KHOẢNG NÀO và BAO NHIÊU NGÀY. Không có dòng này thì
        // mấy con số phần trăm bên dưới là số không rõ gốc — và người đọc sẽ mặc
        // định là "so với trọn kỳ trước", đúng cái hiểu nhầm cần tránh.
        <p className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-[10px] text-slate-500">
          {rich(t("overview.pnl.compare.note", { label: data.comparison.label, days: data.comparison.comparedDays }), "text-slate-700")}
          {data.comparison.truncated && (
            <span className="text-amber-700"> {t("overview.pnl.compare.truncated")}</span>
          )}
        </p>
      )}

      {error ? (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map(i => <div key={i} className="h-64 rounded-2xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {mbc && <MbcCard d={mbc} adSpendTarget={kpi?.adSpendMbc} revenueTarget={kpi?.revenueMbc} channelTargets={kpi?.mbcByChannel} derived={data?.targets?.derived} manualExcluded={data?.manualExcluded} cmp={data?.comparison} channels={channels} />}
          {mbi && <MbiCard d={mbi} adSpendTarget={kpi?.adSpendMbi} ordersTarget={kpi?.ordersMbi} channelTargets={kpi?.mbiByChannel} derived={data?.targets?.derived} manualExcluded={data?.manualExcluded} cmp={data?.comparison} channels={channels} />}
          {!mbc && !mbi && <p className="text-sm text-slate-400 py-6 text-center col-span-2">{t("overview.pnl.noCompany")}</p>}
        </div>
      )}
    </div>
  );
}

function SpendRow({ g, f, t: totalSpend, accent, fbError, ggError, fbStaleAt, manualExcluded, spendDelta, byChannel, budget, channels }: {
  channels: AdChannelDef[];
  g: number; f: number; t: number; accent: string;
  fbError?: string | null; ggError?: string | null;
  /** Chi phí Facebook là số cũ đọc lúc này — số ĐÚNG, chỉ không mới. */
  fbStaleAt?: string | null;
  /** Chế độ tuần: chi phí nhập tay TikTok/Zalo không nằm trong tổng. */
  manualExcluded?: boolean;
  spendDelta?: MetricDelta;
  /** Chi phí thực tế tách theo kênh. Thiếu (payload cũ trong bộ đệm 10 phút)
   *  thì lùi về đúng hai kênh đo được, không bịa ra kênh nào bằng 0. */
  byChannel?: ChannelSpend;
  /** Trần ngân sách theo kênh, đặt ở Settings → KPI. Kênh để 0 = chưa đặt trần. */
  budget?: ChannelBudget;
}) {
  const t = useT();
  const loc = useIntlLocale();
  const { fmtVND } = makeFmt(loc);
  // "0đ" và "không lấy được số" là hai chuyện khác hẳn nhau. Meta chặn khi vượt
  // hạn mức gọi API (`Application request limit reached`) thì chi phí về 0 —
  // hiện thành "0đ" là báo sai một con số tiền, và tổng chi phí bên cạnh cũng
  // thiếu đúng phần đó mà không ai biết.
  const anyError = !!fbError || !!ggError || (!!fbStaleAt && f <= 0);
  // Số cũ KHÁC không có số. Meta ở bậc development_access bị chặn suốt, mà chi
  // tiêu Facebook của một tháng gần như không đổi giữa hai lần xem — nên khi bị
  // chặn thì hiện số đọc được gần nhất KÈM MỐC GIỜ, tốt hơn hẳn một dấu gạch.
  // Chốt thứ hai, độc lập với backend: mốc giờ mà chi phí bằng 0 thì KHÔNG
  // phải một phép đo cũ — đó là "không có số", và dán nhãn "số cũ" kèm câu
  // "con số vẫn đúng tại thời điểm đó" lên số 0 là một lời trấn an sai về tiền.
  // Một tài khoản đang chạy quảng cáo không tiêu đúng 0đ cả tháng.
  const staleUsable = !!fbStaleAt && f > 0;
  const staleLabel = staleUsable
    ? new Date(fbStaleAt!).toLocaleString(loc, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
    : null;
  // Có mốc giờ nhưng số bằng 0 → coi như không lấy được, để tổng bên cạnh được
  // đánh dấu THIẾU thay vì âm thầm cộng 0.
  const fbUnavailable = !!fbError || (!!fbStaleAt && f <= 0);
  // Thiếu bảng theo kênh (payload cũ còn trong bộ đệm) thì chỉ dựng lại hai kênh
  // đo được — KHÔNG suy ngược phần còn lại thành TikTok/Zalo, vì phần chênh có
  // thể là bất cứ kênh nào người ta đã khai.
  const budgetKeys = channels.map(c => c.key);
  const spendKeys = [...budgetKeys, OTHER_CHANNEL.key];
  const emptySpend: ChannelSpend = Object.fromEntries(spendKeys.map(k => [k, 0]));
  /** Kênh lấy số tự động qua API — các kênh còn lại do người khai tay theo tháng. */
  const isAuto = (k: string) => channels.find(c => c.key === k)?.source === "api";
  const spend: ChannelSpend = byChannel
    ? { ...emptySpend, ...byChannel }
    : { ...emptySpend, google: g, facebook: f };

  // Google/Facebook luôn hiện (đo tự động, 0đ là 0đ thật). Kênh nhập tay chỉ
  // hiện khi có tiêu hoặc có trần — bày một ô Zalo 0đ quanh năm chỉ tổ rối.
  // Chế độ tuần: số nhập tay không nằm trong kỳ nên không bày ô nào cả, tránh
  // hiểu nhầm "tuần này TikTok tiêu 0đ".
  const visibleChannels = spendKeys.filter(ch => {
    if (isAuto(ch)) return true;
    if (manualExcluded) return false;
    return spend[ch] > 0 || (ch !== "other" && (budget?.[ch] ?? 0) > 0);
  });

  const overspent = budgetKeys
    .filter(ch => (budget?.[ch] ?? 0) > 0 && spend[ch] > budget![ch])
    .map(ch => ({ ch, over: spend[ch] - budget![ch] }));

  return (
    <div className="space-y-1.5 mb-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {visibleChannels.map(ch => {
          const unavailable = (ch === "facebook" && fbUnavailable) || (ch === "google" && !!ggError);
          const label =
            ch === "facebook" && staleLabel ? t("overview.pnl.facebookStale") : channelLabel(channels, ch);
          return (
            <ChannelCell
              key={ch}
              label={label}
              manual={!isAuto(ch)}
              actual={spend[ch]}
              target={ch === "other" ? 0 : budget?.[ch] ?? 0}
              value={unavailable ? "—" : fmtVND(spend[ch])}
              unavailable={unavailable}
              budgetable={ch !== "other"}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-2">
        <Cell
          label={anyError ? t("overview.pnl.total.missing") : t("overview.pnl.total.sum", { channels: visibleChannels.map(c => channelLabel(channels, c)).join(" + ") })}
          value={fmtVND(totalSpend)} strong accent={accent} delta={spendDelta} money
        />
      </div>
      {overspent.length > 0 && (
        // Vượt trần một kênh là chuyện phải đọc thấy ngay, không phải chuyện đi
        // dò từng ô — nên nhắc lại thành một dòng riêng.
        <p className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-[10px] text-red-800">
          {t("overview.pnl.overspent.prefix")}{" "}
          {overspent.map(o => `${channelLabel(channels, o.ch)} +${fmtVND(o.over)}`).join(" · ")}
          {" "}{rich(t("overview.pnl.overspent.suffix"))}
        </p>
      )}
      {staleLabel && !fbError && (
        <p className="rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1.5 text-[10px] text-sky-800">
          {rich(t("overview.pnl.stale.note", { time: staleLabel }))}
        </p>
      )}
      {anyError && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[10px] text-amber-800">
          {rich(t("overview.pnl.err.unavailable", {
            names: `${fbUnavailable ? "Facebook" : ""}${fbUnavailable && ggError ? t("overview.pnl.err.and") : ""}${ggError ? "Google" : ""}`,
            reason: fbError ?? ggError ?? t("overview.pnl.err.staleZero"),
          }))}
        </p>
      )}
      {manualExcluded && (
        // Chi phí TikTok/Zalo chỉ nhập được theo tháng. Chia đều ra tuần là bịa
        // (tháng đó có thể chỉ chạy TikTok đúng một tuần), nên bỏ ra và nói rõ.
        <p className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-[10px] text-slate-500">
          {rich(t("overview.pnl.manualExcluded"))}
        </p>
      )}
    </div>
  );
}

/**
 * Huy hiệu so kỳ trước.
 *
 * Không hiện phần trăm khi nó không có nghĩa: kỳ trước bằng 0 (chia cho 0) hoặc quá
 * nhỏ so với kỳ này (ra vài nghìn phần trăm). Hiện chữ giải thích thay vì một con số
 * to đùng — số vô nghĩa dạy người dùng ngừng tin cả khối.
 */
function DeltaBadge({ d, money, higherIsBetter }: { d?: MetricDelta; money?: boolean; higherIsBetter?: boolean }) {
  const t = useT();
  const { fmtVND, fmtNum } = makeFmt(useIntlLocale());
  if (!d) return null;
  if (d.noBaseline) {
    return <span className="text-[9px] font-medium text-slate-400">{t("overview.pnl.delta.noBaseline")}</span>;
  }
  if (d.lowBaseline) {
    return <span className="text-[9px] font-medium text-slate-400">{t("overview.pnl.delta.lowBaseline")}</span>;
  }
  if (d.pct === null) return null;

  const flat = Math.abs(d.pct) < 0.05;
  const up = d.diff > 0;
  // Chi phí tăng là xấu, doanh thu/đơn tăng là tốt — cùng một mũi tên lên nhưng
  // khác màu, nếu không thì "chi phí +40%" hiện màu xanh lá là đọc ngược ý.
  const good = higherIsBetter ? up : !up;
  const tone = flat ? "text-slate-400" : good ? "text-emerald-600" : "text-red-500";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const abs = Math.abs(d.diff);
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[9px] font-bold", tone)}
      title={`${t("overview.pnl.delta.prev", { value: money ? fmtVND(d.previous) : fmtNum(d.previous) })}${d.clamped ? t("overview.pnl.delta.clamped") : ""}`}>
      <Icon className="h-2.5 w-2.5" />
      {flat ? t("overview.pnl.delta.flat") : `${d.pct > 0 ? "+" : ""}${d.pct}%`}
      <span className="font-medium text-slate-400">({money ? fmtVND(abs) : fmtNum(abs)})</span>
    </span>
  );
}

function Cell({ label, value, strong, accent, icon, delta, money, higherIsBetter }: {
  label: string; value: string; strong?: boolean; accent?: string; icon?: React.ReactNode;
  delta?: MetricDelta; money?: boolean; higherIsBetter?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase mb-1">{icon}{label}</div>
      <p className={cn("font-black leading-none", strong ? "text-base" : "text-sm", accent ?? "text-slate-800")}>{value}</p>
      {delta && <div className="mt-1"><DeltaBadge d={delta} money={money} higherIsBetter={higherIsBetter} /></div>}
    </div>
  );
}

/**
 * Ô chi phí một kênh. Có trần thì kèm thanh tiến độ riêng của kênh đó — đây là
 * chỗ trả lời câu "kênh nào sắp vượt tiền", mà thanh tổng bên dưới không nói được:
 * tổng vẫn trong hạn mức trong khi Facebook đã tiêu quá phần của nó.
 */
function ChannelCell({ label, value, actual, target, manual, unavailable, budgetable = true }: {
  label: string; value: string; actual: number; target: number;
  /** Kênh do người khai tay (TikTok/Zalo/Kênh khác) — nói ra để không ai tưởng
   *  con số này hệ thống tự đo được. */
  manual?: boolean;
  unavailable?: boolean;
  /** false với "Kênh khác": đặt trần riêng cho nó không được, nên đừng gợi ý
   *  là "chưa đặt" — người đọc sẽ đi tìm ô nhập không tồn tại. */
  budgetable?: boolean;
}) {
  const t = useT();
  const { fmtVND } = makeFmt(useIntlLocale());
  const hasTarget = target > 0 && !unavailable;
  const pct = hasTarget ? Math.round((actual / target) * 100) : 0;
  const diff = actual - target;
  const tone = pct > 100
    ? { bar: "bg-red-500", text: "text-red-600" }
    : pct >= 80
    ? { bar: "bg-amber-500", text: "text-amber-600" }
    : { bar: "bg-emerald-500", text: "text-emerald-600" };

  return (
    <div className={cn(
      "rounded-xl border p-2.5",
      hasTarget && pct > 100 ? "border-red-200 bg-red-50/50" : "border-slate-100 bg-slate-50/60",
    )}>
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[10px] font-semibold text-slate-400 uppercase truncate">
          {label}
          {manual && (
            <span className="ml-1 normal-case font-normal text-[9px] text-slate-400"
              title={t("overview.pnl.channel.manualHint")}>
              {t("overview.pnl.channel.manual")}
            </span>
          )}
        </span>
        {hasTarget && <span className={cn("text-[10px] font-black shrink-0", tone.text)}>{pct}%</span>}
      </div>
      <p className="text-sm font-black leading-none text-slate-800">{value}</p>
      {hasTarget && (
        <>
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden my-1.5">
            <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="text-[9px] text-slate-500">
            {t("overview.pnl.channel.cap", { amount: fmtVND(target) })} ·{" "}
            <span className={tone.text}>{diff > 0 ? t("overview.pnl.over", { amount: fmtVND(diff) }) : t("overview.pnl.left", { amount: fmtVND(-diff) })}</span>
          </p>
        </>
      )}
      {!hasTarget && !unavailable && (
        <p className="text-[9px] text-slate-300 mt-1.5">
          {budgetable ? t("overview.pnl.channel.noCap") : t("overview.pnl.channel.noCapOwn")}
        </p>
      )}
    </div>
  );
}

/**
 * Thanh tiến độ KPI. higherIsBetter=false (chi QC): vượt = đỏ.
 * higherIsBetter=true (DT/Đơn): đạt cao = xanh, thiếu = đỏ.
 */
function KpiBar({ label, actual, target, money, higherIsBetter, derived }: { label: string; actual: number; target?: number; money?: boolean; higherIsBetter?: boolean; derived?: boolean }) {
  const t = useT();
  const { fmtVND, fmtNum } = makeFmt(useIntlLocale());
  if (!target) return null;
  const pct = Math.round((actual / target) * 100);
  const diff = actual - target;
  const f = (v: number) => (money ? fmtVND(v) : fmtNum(Math.round(v)));
  const tone = higherIsBetter
    ? (pct >= 100 ? { bar: "bg-emerald-500", text: "text-emerald-600" } : pct >= 80 ? { bar: "bg-amber-500", text: "text-amber-600" } : { bar: "bg-red-500", text: "text-red-500" })
    : (pct > 100 ? { bar: "bg-red-500", text: "text-red-600" } : pct >= 80 ? { bar: "bg-amber-500", text: "text-amber-600" } : { bar: "bg-emerald-500", text: "text-emerald-600" });
  const note = higherIsBetter
    ? (diff >= 0 ? t("overview.pnl.over", { amount: f(diff) }) : t("overview.pnl.short", { amount: f(-diff) }))
    : (diff >= 0 ? t("overview.pnl.over", { amount: f(diff) }) : t("overview.pnl.left", { amount: f(-diff) }));
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-slate-400 uppercase">
          {label}
          {derived && (
            // Con số này KHÔNG do ai đặt cho tuần — nó là KPI tháng chia đều theo
            // ngày. Không dán nhãn thì người đọc sẽ hiểu là cam kết của tuần.
            <span
              className="ml-1 normal-case font-normal text-[9px] text-amber-600"
              title={t("overview.pnl.kpi.derivedHint")}
            >
              {t("overview.pnl.kpi.derived")}
            </span>
          )}
        </span>
        <span className={cn("text-xs font-black", tone.text)}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1">
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="text-[10px] text-slate-500">
        <span className="font-semibold text-slate-700">{f(actual)}</span>
        <span className="text-slate-400"> / {f(target)} · </span>
        <span className={tone.text}>{note}</span>
      </p>
    </div>
  );
}

/** 12/10: chỉ hiện khi tháng có tiền đối tác hỗ trợ — tổng chi ở trên vẫn là chi tiêu gộp (so với trần đã cộng hỗ trợ);
 *  chi phí/đơn và tỉ lệ QC/DT bên dưới tính theo chi phí thật. */
function SupportLine({ support, net }: { support?: number; net?: number }) {
  const t = useT();
  const { fmtVND } = makeFmt(useIntlLocale());
  if (!support || support <= 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 mb-2">
      <span className="text-emerald-800">{t("overview.pnl.support.partner")} <b>−{fmtVND(support)}</b></span>
      <span className="text-slate-700">{t("overview.pnl.support.net")} <b>{fmtVND(net ?? 0)}</b></span>
    </div>
  );
}

function MbcCard({ d, adSpendTarget, revenueTarget, channelTargets, derived, manualExcluded, cmp, channels }: { channels: AdChannelDef[]; d: MbcPnl; adSpendTarget?: number; revenueTarget?: number; channelTargets?: ChannelBudget; derived?: boolean; manualExcluded?: boolean; cmp?: PnlComparison }) {
  const t = useT();
  const { fmtVND, fmtNum } = makeFmt(useIntlLocale());
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/30 p-4" style={{ borderLeftWidth: 3, borderLeftColor: "#2563eb" }}>
      <h3 className="text-sm font-bold text-blue-700 mb-3">{t("overview.pnl.mbc.title")}</h3>
      <SpendRow g={d.spendGoogle} f={d.spendFacebook} t={d.totalSpend} accent="text-blue-700" fbError={d.spendFacebookError} ggError={d.spendGoogleError} fbStaleAt={d.spendFacebookStaleAt} manualExcluded={manualExcluded} spendDelta={cmp?.MBC.totalSpend} byChannel={d.spendByChannel} budget={channelTargets} channels={channels} />
      <SupportLine support={d.partnerSupport} net={d.netSpend} />
      {d.revenueSourceError && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {t("overview.pnl.mbc.revenueError")}
        </div>
      )}
      <KpiBar label={t("overview.pnl.kpi.revenue")} actual={d.revenue} target={revenueTarget} money higherIsBetter derived={derived} />
      <KpiBar label={t("overview.pnl.kpi.adBudget")} actual={d.totalSpend} target={adSpendTarget} money derived={derived} />
      <div className="grid grid-cols-2 gap-2">
        <Cell label={t("overview.pnl.cell.revenue")} value={fmtVND(d.revenue)} icon={<TrendingUp className="h-3 w-3" />} delta={cmp?.MBC.revenue} money higherIsBetter />
        <Cell label={t("overview.pnl.cell.orders")} value={fmtNum(d.orders)} icon={<ShoppingCart className="h-3 w-3" />} delta={cmp?.MBC.orders} higherIsBetter />
        <Cell label={t("overview.pnl.cell.aov")} value={fmtVND(d.aov)} />
        <Cell label={t("overview.pnl.cell.costPerOrder")} value={fmtVND(d.costPerOrder)} />
        <Cell label={t("overview.pnl.cell.adRatio")} value={`${d.adCostRatioPct}%`} icon={<Percent className="h-3 w-3" />} accent={d.adCostRatioPct > 30 ? "text-red-600" : d.adCostRatioPct > 15 ? "text-amber-600" : "text-emerald-600"} />
        <Cell label={t("overview.pnl.cell.projectedRevenue")} value={fmtVND(d.projectedRevenue)} accent="text-violet-700" />
      </div>
    </div>
  );
}

function MbiCard({ d, adSpendTarget, ordersTarget, channelTargets, derived, manualExcluded, cmp, channels }: { channels: AdChannelDef[]; d: MbiPnl; adSpendTarget?: number; ordersTarget?: number; channelTargets?: ChannelBudget; derived?: boolean; manualExcluded?: boolean; cmp?: PnlComparison }) {
  const t = useT();
  const { fmtVND, fmtNum } = makeFmt(useIntlLocale());
  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/30 p-4" style={{ borderLeftWidth: 3, borderLeftColor: "#7c3aed" }}>
      <h3 className="text-sm font-bold text-violet-700 mb-3">{t("overview.pnl.mbi.title")}</h3>
      <SpendRow g={d.spendGoogle} f={d.spendFacebook} t={d.totalSpend} accent="text-violet-700" fbError={d.spendFacebookError} ggError={d.spendGoogleError} fbStaleAt={d.spendFacebookStaleAt} manualExcluded={manualExcluded} spendDelta={cmp?.MBI.totalSpend} byChannel={d.spendByChannel} budget={channelTargets} channels={channels} />
      <SupportLine support={d.partnerSupport} net={d.netSpend} />
      {d.ordersSourceError && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {t("overview.pnl.mbi.ordersError")}
        </div>
      )}
      <KpiBar label={t("overview.pnl.kpi.orders")} actual={d.orders} target={ordersTarget} higherIsBetter derived={derived} />
      <KpiBar label={t("overview.pnl.kpi.adBudget")} actual={d.totalSpend} target={adSpendTarget} money derived={derived} />
      <div className="grid grid-cols-2 gap-2">
        <Cell label={t("overview.pnl.cell.orders")} value={fmtNum(d.orders)} icon={<ShoppingCart className="h-3 w-3" />} delta={cmp?.MBI.orders} higherIsBetter />
        <Cell label={t("overview.pnl.cell.costPerOrder")} value={fmtVND(d.costPerOrder)} accent={d.costPerOrder > 300000 ? "text-red-600" : "text-slate-800"} />
        <Cell label={t("overview.pnl.cell.projectedOrders")} value={fmtNum(d.projectedOrders)} accent="text-violet-700" />
      </div>
      <p className="text-[10px] text-slate-400 mt-2">{t("overview.pnl.mbi.note")}</p>
    </div>
  );
}
