// ============================================================
// Audience Overlap — targeting-similarity proxy
// ============================================================
// Meta deprecated the standalone Audience Overlap comparison from the
// public Marketing API years ago — there is no callable pairwise-overlap
// endpoint anymore (only /reachestimate exists, a single-audience size
// estimate, not an overlap ratio). This computes a real proxy from the
// targeting spec Meta already returns per ad set: two ad sets aimed at
// near-identical interests/custom-audiences/geo/age are very likely
// competing for the same people in the auction, even without a true
// reach-intersection number. Deliberately labeled "targeting similarity"
// everywhere, not "audience overlap", to not overstate precision.

import type { MetaAdSetTargetingRaw } from "@/lib/meta-client";

function jaccard(a: string[], b: string[]): number | null {
  if (a.length === 0 && b.length === 0) return null; // neither ad set uses this signal — not comparable
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

function interestIds(t?: MetaAdSetTargetingRaw["targeting"]): string[] {
  return (t?.flexible_spec ?? []).flatMap(spec => [
    ...(spec.interests ?? []).map(i => `i:${i.id}`),
    ...(spec.behaviors ?? []).map(b => `b:${b.id}`),
  ]);
}

function customAudienceIds(t?: MetaAdSetTargetingRaw["targeting"]): string[] {
  return (t?.custom_audiences ?? []).map(a => a.id);
}

function geoIds(t?: MetaAdSetTargetingRaw["targeting"]): string[] {
  const geo = t?.geo_locations;
  if (!geo) return [];
  return [
    ...(geo.countries ?? []).map(c => `c:${c}`),
    ...(geo.regions ?? []).map(r => `r:${r.key}`),
    ...(geo.cities ?? []).map(c => `city:${c.key}`),
  ];
}

function ageOverlapFraction(t1?: MetaAdSetTargetingRaw["targeting"], t2?: MetaAdSetTargetingRaw["targeting"]): number | null {
  const min1 = t1?.age_min ?? 18, max1 = t1?.age_max ?? 65;
  const min2 = t2?.age_min ?? 18, max2 = t2?.age_max ?? 65;
  const overlapStart = Math.max(min1, min2);
  const overlapEnd = Math.min(max1, max2);
  const overlapLen = Math.max(0, overlapEnd - overlapStart);
  const unionLen = Math.max(max1, max2) - Math.min(min1, min2);
  return unionLen > 0 ? overlapLen / unionLen : 1;
}

function genderMatch(t1?: MetaAdSetTargetingRaw["targeting"], t2?: MetaAdSetTargetingRaw["targeting"]): number {
  const g1 = t1?.genders ?? [];
  const g2 = t2?.genders ?? [];
  if (g1.length === 0 && g2.length === 0) return 1; // both "all genders"
  const setA = new Set(g1.length ? g1 : [1, 2]);
  const setB = new Set(g2.length ? g2 : [1, 2]);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

export interface OverlapResult {
  adSetA: { id: string; name: string; campaignId: string; campaignName: string };
  adSetB: { id: string; name: string; campaignId: string; campaignName: string };
  similarityPct: number;
  signals: {
    interests: number | null;
    customAudiences: number | null;
    geo: number | null;
    age: number;
    gender: number;
  };
}

/** Weighted similarity — dimensions absent from BOTH ad sets are excluded
 * (renormalized), not scored as 0 or 1, so e.g. two broad-targeting ad
 * sets with no interests don't falsely look "0% similar" on that axis. */
export function computeTargetingSimilarity(
  a: MetaAdSetTargetingRaw,
  b: MetaAdSetTargetingRaw
): OverlapResult["signals"] & { overall: number } {
  const interests = jaccard(interestIds(a.targeting), interestIds(b.targeting));
  const customAudiences = jaccard(customAudienceIds(a.targeting), customAudienceIds(b.targeting));
  const geo = jaccard(geoIds(a.targeting), geoIds(b.targeting));
  const age = ageOverlapFraction(a.targeting, b.targeting) ?? 1;
  const gender = genderMatch(a.targeting, b.targeting);

  const weighted: Array<[number | null, number]> = [
    [interests, 0.35],
    [customAudiences, 0.20],
    [geo, 0.25],
    [age, 0.15],
    [gender, 0.05],
  ];
  const present = weighted.filter(([v]) => v !== null) as Array<[number, number]>;
  const weightSum = present.reduce((s, [, w]) => s + w, 0);
  const overall = weightSum > 0
    ? present.reduce((s, [v, w]) => s + v * w, 0) / weightSum
    : 0;

  return { interests, customAudiences, geo, age, gender, overall };
}

// 55% initially seemed reasonable but produced 1,566 pairs on a real 117-ad-set
// account — verified live: most of that "noisy middle" (50-70%) was two ad
// sets sharing only generic geo/age/gender (both targeting all of Vietnam,
// 18-65) with NO real interest overlap, which isn't a meaningful
// self-competition signal. Raised to 75% based on the real score
// distribution observed (a sharp drop-off above 75%: 236 pairs vs 1,566),
// which reliably captures genuine near-duplicate targeting instead of
// coincidental broad-targeting similarity.
const MIN_SIMILARITY_PCT = 75;
const MAX_RESULTS = 50; // cap the response size — see totalQualifyingPairs for the real count

export function findOverlappingAdSetPairs(adSets: MetaAdSetTargetingRaw[]): { pairs: OverlapResult[]; totalQualifyingPairs: number } {
  const results: OverlapResult[] = [];
  for (let i = 0; i < adSets.length; i++) {
    for (let j = i + 1; j < adSets.length; j++) {
      const a = adSets[i], b = adSets[j];
      const sig = computeTargetingSimilarity(a, b);
      const pct = Math.round(sig.overall * 100);
      if (pct < MIN_SIMILARITY_PCT) continue;
      results.push({
        adSetA: { id: a.id, name: a.name, campaignId: a.campaign_id, campaignName: a.campaign?.name ?? "" },
        adSetB: { id: b.id, name: b.name, campaignId: b.campaign_id, campaignName: b.campaign?.name ?? "" },
        similarityPct: pct,
        signals: { interests: sig.interests, customAudiences: sig.customAudiences, geo: sig.geo, age: sig.age, gender: sig.gender },
      });
    }
  }
  const sorted = results.sort((x, y) => y.similarityPct - x.similarityPct);
  return { pairs: sorted.slice(0, MAX_RESULTS), totalQualifyingPairs: sorted.length };
}
