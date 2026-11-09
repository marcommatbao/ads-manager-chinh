// ============================================================
// AdsCommand — Improvements Types
// ============================================================

export type Platform = "FACEBOOK" | "GOOGLE" | "ALL";
export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type ImprovementStatus = "ACTIVE" | "COMPLETED" | "DISMISSED";

export interface Metric {
  label: string;
  value: string;
  type: "positive" | "negative" | "neutral" | "target";
}

export interface Improvement {
  id: string;
  platform: Platform;
  type: string;
  source: "GOOGLE" | "FACEBOOK" | "CROSS_CHANNEL";
  priority: Priority;
  status: ImprovementStatus;
  confidence: number;
  title: string;
  description: string;
  campaignId?: string;
  campaignName?: string;
  adGroupName?: string;
  adName?: string;
  keyword?: string;
  metrics?: Metric[];
  currentMetric?: string;
  targetMetric?: string;
  recommendation?: string;
  impact?: string;
  impactValue?: number;
  /** true = impactValue là ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được. */
  impactRough?: boolean;
  estimatedImpact?: number;
  canAutoApply: boolean;
  createdAt?: string;
  applyPayload?: Record<string, any>;
  reasoning?: string;
  company?: string;
}

export function detectPlatform(
  item: Partial<Improvement> & { source?: string; customerId?: string }
): Platform {
  if (
    item.source === "FACEBOOK" ||
    item.campaignId?.startsWith("fb_")
  ) {
    return "FACEBOOK";
  }

  if (
    item.source === "GOOGLE" ||
    item.campaignId?.startsWith("gg_") ||
    item.customerId !== undefined
  ) {
    return "GOOGLE";
  }

  if (item.title?.includes("FB Ad") || item.description?.includes("FACEBOOK")) {
    return "FACEBOOK";
  }
  if (item.title?.includes("Google") || item.description?.includes("GOOGLE")) {
    return "GOOGLE";
  }

  return "FACEBOOK"; // default fallback
}

export type ActionStepType =
  | "PAUSE_AD"            // Tắt quảng cáo
  | "PAUSE_ADSET"         // Tắt ad set
  | "SET_DAYPARTING"      // Thiết lập khung giờ
  | "SET_BID"             // Thay đổi bid
  | "SET_BUDGET"          // Thay đổi budget
  | "UPDATE_TARGETING"    // Cập nhật targeting
  | "CHANGE_CREATIVE"     // Gợi ý thay creative (manual)
  | "PAUSE_KEYWORD"       // Google: tắt từ khóa
  | "CHANGE_MATCH_TYPE"   // Google: đổi match type
  | "SET_KEYWORD_BID"     // Google: đặt bid từ khóa
  | "ADD_NEGATIVE"        // Thêm từ khóa phủ định
  | "UNKNOWN";            // Fallback

export interface ActionStep {
  id:          string;
  type:        ActionStepType;
  platform:    "FACEBOOK" | "GOOGLE";
  title:       string;        
  description: string;        
  entityId:    string;        
  entityName:  string;        
  payload:     Record<string, any>;  
  canAutoApply:boolean;       
  estimatedImpact: number;    
  before: Record<string, string>;  
  after:  Record<string, string>;  
}

export interface ActionPlan {
  improvementId: string;
  steps:         ActionStep[];
  totalImpact:   number;
  autoSteps:     number;   
  manualSteps:   number;   
  status:  "PENDING" | "APPLYING" | "APPLIED" | "FAILED" | "UNDONE";
  appliedAt?: string;
  undoDeadline?: string;   
}

