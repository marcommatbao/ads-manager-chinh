// ============================================================
// Quality Score drop summary — lightweight version for the daily
// alerts digest. Reuses the same real GAQL query + history-diff logic
// as app/api/google/toolkit/quality-score/route.ts, trimmed down to
// just the counts a digest needs (poor/declining), without the
// per-keyword suggestion/weakest detail the toolkit page renders.
// ============================================================

import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { readQSHistory, previousSnapshotIndex } from "@/lib/qs-history";

export interface QSDropSummary {
  poor: number;
  declining: number;
  total: number;
}

export async function getQualityScoreDropSummary(company: string): Promise<QSDropSummary> {
  const customer = getGoogleAdsCustomer(company);

  const rows = await customer.query(`
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.quality_info.quality_score
    FROM keyword_view
    WHERE campaign.status = 'ENABLED'
      AND ad_group.status = 'ENABLED'
      AND ad_group_criterion.status = 'ENABLED'
      AND segments.date DURING LAST_7_DAYS
  `);

  const allHistory = await readQSHistory();
  // Prior QS per keyword, from a day BEFORE today. Taking simply the newest
  // record made this count zero declining keywords whenever the snapshot for
  // today had already been written (by the toolkit page or the snapshot cron,
  // which runs before this digest) — it was comparing today against today.
  const latestPerKw = previousSnapshotIndex(allHistory, company);

  let poor = 0;
  let declining = 0;
  let total = 0;

  for (const row of rows as Array<{ ad_group_criterion?: { criterion_id?: unknown; quality_info?: { quality_score?: number } } }>) {
    const qs = row.ad_group_criterion?.quality_info?.quality_score ?? 0;
    if (qs <= 0) continue;
    total++;
    if (qs < 4) poor++;

    const critId = String(row.ad_group_criterion?.criterion_id ?? "");
    const prevQS = latestPerKw.get(critId)?.qualityScore;
    if (prevQS !== undefined && qs < prevQS) declining++;
  }

  return { poor, declining, total };
}
