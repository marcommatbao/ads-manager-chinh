"use client";

// ============================================================
// "Nhập phiên từ tệp" (Đợt 6 · B1) — chỉ super_admin. Đưa phiên đã áp ở bản
// chạy cục bộ lên prod bằng tệp .json gộp {cases:[...]}. Đọc tệp trong trình
// duyệt, POST /api/cases/import — trùng mã thì server tự bỏ qua, KHÔNG ghi
// đè (xem lib/case/store.ts importCase()).
// ============================================================

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { postJson, ApiError } from "@/components/case/api";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

type ImportStatus = "imported" | "exists" | "invalid";
interface ImportResultRow {
  id: string;
  campaignName: string;
  status: ImportStatus;
  reason?: string;
}

const STATUS_PILL: Record<ImportStatus, { tone: PillTone; text: MessageKey }> = {
  imported: { tone: "green", text: "overview.import.pill.imported" },
  exists: { tone: "grey", text: "overview.import.pill.exists" },
  invalid: { tone: "red", text: "overview.import.pill.invalid" },
};

// Chuỗi từ điển có <b>…</b> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string): React.ReactNode[] {
  return s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

export function ImportCasesDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResultRow[] | null>(null);

  function reset() {
    setFile(null);
    setImporting(false);
    setError(null);
    setResults(null);
  }

  function close() {
    if (importing) return;
    onOpenChange(false);
    reset();
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError(t("overview.import.badJson"));
        return;
      }
      const json = await postJson("/api/cases/import", parsed);
      setResults(json.results ?? []);
      onImported();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("overview.import.connError"));
    } finally {
      setImporting(false);
    }
  }

  const imported = results?.filter((r) => r.status === "imported").length ?? 0;
  const skipped = results?.filter((r) => r.status === "exists").length ?? 0;
  const invalid = results?.filter((r) => r.status === "invalid").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("overview.import.title")}</DialogTitle>
        </DialogHeader>

        {!results ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="import-cases-file">
                {t("overview.import.fileLabel")}
              </label>
              <input
                id="import-cases-file"
                type="file"
                accept=".json"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            </div>
            <p className="text-xs text-slate-500">
              {rich(t("overview.import.hint"))}
            </p>
            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        ) : (
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-800">
              {t("overview.import.resultHead", { imported, skipped })}{invalid > 0 ? `, ${t("overview.import.resultInvalid", { invalid })}` : ""}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">{t("overview.import.thCase")}</th>
                    <th className="px-3 py-2 font-medium">{t("overview.import.thResult")}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const pill = STATUS_PILL[r.status];
                    return (
                      <tr key={`${r.id}-${i}`} className="border-b border-slate-50 align-top last:border-0">
                        <td className="px-3 py-2 text-slate-700">{r.campaignName}</td>
                        <td className="px-3 py-2">
                          <Pill tone={pill.tone}>{r.status === "invalid" && r.reason ? `${t(pill.text)}: ${r.reason}` : t(pill.text)}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={importing}>{t("overview.import.close")}</Button>
          {!results && (
            <Button onClick={handleImport} disabled={!file || importing}>
              {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("overview.import.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
