"use client";

import { useState, useEffect } from "react";
import { resolveCompanyScope } from "@/lib/permissions";
import { useRouter } from "next/navigation";
import { FileText, ArrowLeft, History, X, Trash2, Sparkles, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BriefBuilder } from "@/components/creative/BriefBuilder";
import { BriefPreview } from "@/components/creative/BriefPreview";
import { BriefStatusBadge } from "@/components/creative/BriefStatusBadge";
import { useSession } from "@/components/SessionProvider";
import type { CreativeBrief } from "@/lib/creative-brief/types";
import { buildGenerateRequests } from "@/lib/creative-brief/generate-bridge";
import type { CreativeResult } from "@/lib/creative-pipeline";
import { useIntlLocale, useT } from "@/lib/i18n/client";

const WIZARD_SESSION_KEY = "adscommand_creative_wizard";

// Brief's 4-value objective → wizard's 3-value Meta objective. Editable by
// the user again in Step 4 before launch — this only seeds a reasonable default.
const OBJECTIVE_KEY_MAP: Record<CreativeBrief["objective"], string> = {
  awareness:     "OUTCOME_TRAFFIC",
  consideration: "OUTCOME_TRAFFIC",
  conversion:    "OUTCOME_LEADS",
  retention:     "OUTCOME_SALES",
};

// ── Draft History Panel ───────────────────────────────────────

interface DraftSummary {
  id: string;
  name: string;
  updatedAt: string;
  input:  { company: string; product: string };
  output?: CreativeBrief;
}

function DraftHistoryPanel({
  onSelect,
  onClose,
}: {
  onSelect: (brief: CreativeBrief) => void;
  onClose: () => void;
}) {
  const t = useT();
  const loc = useIntlLocale();
  const [drafts, setDrafts]   = useState<DraftSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = async () => {
    if (drafts) return;
    setLoading(true);
    try {
      const res  = await fetch("/api/creative/brief?limit=20");
      const json = await res.json() as { success?: boolean; data?: { drafts: DraftSummary[] } };
      setDrafts(json.data?.drafts ?? []);
    } catch {
      setError(t("creative.briefPage.historyLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const deleteDraft = async (id: string) => {
    await fetch(`/api/creative/brief/${id}`, { method: "DELETE" });
    setDrafts(prev => prev?.filter(d => d.id !== id) ?? null);
  };

  // Load on mount
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <History className="h-4 w-4 text-indigo-500" /> {t("creative.briefPage.historyTitle")}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 p-4 space-y-2">
          {loading && <p className="text-xs text-slate-400 text-center py-8">{t("creative.briefPage.loading")}</p>}
          {error && <p className="text-xs text-red-500 text-center py-4">{error}</p>}
          {drafts?.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8">{t("creative.briefPage.noBriefs")}</p>
          )}
          {drafts?.map(d => (
            <div key={d.id} className="rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition-all">
              <div className="flex items-start justify-between gap-2">
                <button
                  className="flex-1 text-left min-w-0"
                  onClick={() => d.output && onSelect(d.output)}
                  disabled={!d.output}
                >
                  <p className="text-xs font-semibold text-slate-800 truncate">{d.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {d.input.company} · {d.input.product} · {new Date(d.updatedAt).toLocaleDateString(loc)}
                  </p>
                  {d.output && <BriefStatusBadge brief={d.output} className="mt-1.5" />}
                  {!d.output && <span className="text-[10px] text-slate-300">{t("creative.briefPage.notGenerated")}</span>}
                </button>
                <button
                  onClick={() => void deleteDraft(d.id)}
                  className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-400 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function CreativeBriefPage() {
  const t = useT();
  const session = useSession();
  const router  = useRouter();
  // companies[0] là PHẠM VI chứ không phải công ty: với ["ALL"] (giá trị của
  // mọi tài khoản hiện nay) dòng cũ ép "ALL" thành string rồi gửi chuỗi
  // "ALL" đi như một mã công ty. Mở phạm vi ra rồi lấy cái đầu.
  const company = resolveCompanyScope(session?.user?.companies, session?.user?.role)[0] ?? "MBC";

  const [viewingBrief, setViewingBrief] = useState<CreativeBrief | null>(null);
  const [showHistory,  setShowHistory]  = useState(false);
  const [generating,   setGenerating]   = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Brief → ad copy hand-off: call generate-text once per (platform × tone)
  // implied by the brief, then drop the results into the same sessionStorage
  // key the main wizard restores from on mount, and redirect there landed
  // on Step 3 — closes the "brief built, then nothing happens" dead end.
  async function handleGenerateFromBrief(brief: CreativeBrief) {
    setGenerating(true);
    setGenerateError(null);
    try {
      const requests = buildGenerateRequests(brief);
      const results: CreativeResult[] = [];

      for (const req of requests) {
        const res = await fetch("/api/creative/generate-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 15000));
        }
        const json = await res.json() as { success?: boolean; data?: CreativeResult; error?: string };
        if (json.success && json.data) {
          results.push({ ...json.data, selected: true });
        }
        // Space out calls — same rate-limit courtesy as the main wizard.
        await new Promise(r => setTimeout(r, 600));
      }

      if (results.length === 0) {
        setGenerateError(t("creative.briefPage.noCopy"));
        return;
      }

      const wizardState = {
        step: 3,
        creativeResults: results,
        creatives: [],
        audienceData: null,
        selectedProduct: brief.product.key,
        customProduct: brief.product.key === "custom" ? brief.product.displayName : "",
        objective: OBJECTIVE_KEY_MAP[brief.objective],
        platform: brief.platform,
        company: brief.company,
      };
      sessionStorage.setItem(WIZARD_SESSION_KEY, JSON.stringify(wizardState));
      router.push("/creative?fromBrief=1");
    } catch {
      setGenerateError(t("creative.briefPage.genError"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/creative" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-500" />
              <div>
                <p className="text-sm font-bold text-slate-800">Creative Brief Builder</p>
                <p className="text-[10px] text-slate-400">Product-aware brief → generation</p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowHistory(true)}
          >
            <History className="h-3.5 w-3.5" /> {t("creative.briefPage.history")}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {viewingBrief ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline" size="sm"
                  className="gap-1 text-xs"
                  onClick={() => setViewingBrief(null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> {t("creative.briefPage.createNew")}
                </Button>
                <h2 className="text-sm font-bold text-slate-800">
                  {viewingBrief.product.displayName} — {viewingBrief.company}
                </h2>
              </div>
              <Button
                size="sm"
                className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700"
                disabled={generating}
                onClick={() => void handleGenerateFromBrief(viewingBrief)}
              >
                {generating
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("creative.briefPage.generatingCopy")}</>
                  : <><Sparkles className="h-3.5 w-3.5" /> Generate Ad Copy →</>}
              </Button>
            </div>
            {generateError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {generateError}
              </div>
            )}
            <BriefPreview brief={viewingBrief} />
          </div>
        ) : (
          <BriefBuilder
            initialCompany={company}
            onBriefGenerated={brief => {
              setViewingBrief(brief);
            }}
          />
        )}
      </div>

      {/* History drawer */}
      {showHistory && (
        <DraftHistoryPanel
          onSelect={brief => { setViewingBrief(brief); setShowHistory(false); }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
