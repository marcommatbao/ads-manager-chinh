"use client";

// ============================================================
// PMax "🎨 Asset" — nội dung tab `assets` trong /google-pmax, deep link
// `?tab=assets` (mirror tab "🧪 Thí nghiệm", xem PmaxExperimentView.tsx —
// cùng nhận `company` từ toggle MBC/MBI ở page.tsx).
// ------------------------------------------------------------
// 4 mảnh, mỗi mảnh 1 file riêng:
//   AssetHealthPanel   — A5 + E2: chấm sức khoẻ asset group + thay asset chữ yếu (tự tải, tài nguyên riêng)
//   ThemesPanel        — E1: search theme theo lượt tìm thắng
//   NewAssetGroupPanel — E1: asset group mới theo chủ đề
//   CleanupPanel       — D3: dọn PMax cũ (gắn nhãn, không xoá) (tự tải, tài nguyên riêng)
// ThemesPanel và NewAssetGroupPanel dùng CHUNG một lần gọi GET
// /api/google/pmax/themes (route trả cả search theme lẫn asset group mới,
// xem lib/pmax/themes.ts) — tải MỘT LẦN ở đây rồi truyền props xuống, tránh
// hai panel cùng gọi trùng một endpoint. AssetHealthPanel và CleanupPanel là
// tài nguyên độc lập (asset_group_asset vs campaign đã tạm dừng) nên tự
// tải/tự làm mới, không phụ thuộc vòng đời của nhóm theme.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { getJson, ApiError } from "@/components/case/api";
import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { AssetHealthPanel } from "./AssetHealthPanel";
import { ThemesPanel } from "./ThemesPanel";
import { NewAssetGroupPanel } from "./NewAssetGroupPanel";
import { CleanupPanel } from "./CleanupPanel";
import type { NewAssetGroupRecord, ThemeExecution, ThemeGroup } from "@/lib/pmax/themes";

type Company = string;

interface ThemesResponse {
  groups: ThemeGroup[];
  maxThemes: number;
  history: ThemeExecution[];
  newAssetGroups: NewAssetGroupRecord[];
  canEdit: boolean;
  confirmText: string;
}

export function PmaxAssetsView({ company }: { company: Company }) {
  const t = useT();
  const [data, setData] = useState<ThemesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/google/pmax/themes?company=${company}`);
      setData(json as ThemesResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.pmaxAssets.connErr"));
    } finally {
      setLoading(false); setReloading(false);
    }
  }, [company, t]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return (
    <div className="space-y-8">
      <AssetHealthPanel company={company} />

      <div className="space-y-8 border-t border-slate-100 pt-8">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={refresh} disabled={loading || reloading}>
            {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxAssets.reload")}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
        ) : !data ? null : (
          <>
            <ThemesPanel
              company={company}
              groups={data.groups}
              maxThemes={data.maxThemes}
              history={data.history}
              canEdit={data.canEdit}
              confirmText={data.confirmText}
              onChanged={refresh}
            />
            <div className="border-t border-slate-100 pt-8">
              <NewAssetGroupPanel
                company={company}
                groups={data.groups}
                newAssetGroups={data.newAssetGroups}
                canEdit={data.canEdit}
                confirmText={data.confirmText}
                onChanged={refresh}
              />
            </div>
          </>
        )}
      </div>

      <div className="border-t border-slate-100 pt-8">
        <CleanupPanel company={company} />
      </div>
    </div>
  );
}
