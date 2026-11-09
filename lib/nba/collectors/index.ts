// ============================================================
// NBA collectors — registry
// Thêm collector mới vào COLLECTORS để engine tự gom.
// ============================================================

import type { Campaign } from "@/types/ads.types";
import type { NbaSignal, NbaContext } from "../types";
import { cplCollector } from "./cpl";
import { fatigueCollector } from "./fatigue";
import { budgetCollector } from "./budget";

export type Collector = (campaigns: Campaign[], ctx: NbaContext) => NbaSignal[];

export const COLLECTORS: Collector[] = [
  cplCollector,
  fatigueCollector,
  budgetCollector,
];
