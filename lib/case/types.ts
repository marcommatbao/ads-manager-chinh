// ============================================================
// Kiểu dữ liệu của "Xử lý chiến dịch" (Campaign Case)
// ============================================================
// Bằng chứng (Evidence) là ẢNH CHỤP lúc thu thập — lưu vào phiên để kết luận
// tái lập được, không gọi lại API mỗi lần mở phiên. Mọi số tiền là VND
// (đã chia micros).

/** Đợt 21a: mã công ty của bản cài (lib/companies). Bản Mắt Bão: "MBC" | "MBI". Kiểm đầu vào bằng isCompany(). */
export type Company = string
export type SourceStatus = "ok" | "partial" | "error"

export interface EvidenceSource {
  id: string
  label: string
  status: SourceStatus
  rows: number
  note?: string
}

export interface SearchCampaignFacts {
  id: string
  name: string
  status: string            // ENABLED | PAUSED
  channel: string           // SEARCH | PERFORMANCE_MAX …
  biddingType: string       // MAXIMIZE_CONVERSIONS | TARGET_CPA | MANUAL_CPC …
  targetCpa: number | null
  targetRoas: number | null
  budgetDaily: number | null
  cost: number
  clicks: number
  impressions: number
  /** metrics.conversions — chỉ các chuyển đổi dùng để đặt giá. */
  orders: number
  orderValue: number
  allConversions: number
  impressionShare: number | null
  lostIsBudget: number | null
  lostIsRank: number | null
}

export interface ConversionByAction {
  name: string
  category: string          // PURCHASE | ADD_TO_CART | …
  conversions: number
  allConversions: number
  value: number
}

export interface KeywordFacts {
  text: string
  match: string             // EXACT | PHRASE | BROAD
  status: string
  qualityScore: number | null
  landingExperience: string | null   // BELOW_AVERAGE | AVERAGE | ABOVE_AVERAGE
  expectedCtr: string | null
  cost: number
  clicks: number
  impressions: number
  conversions: number
}

export interface SearchTermFacts {
  term: string
  matchType: string         // NEAR_PHRASE | BROAD | …
  cost: number
  clicks: number
  conversions: number
  allConversions: number
}

export interface NetworkSlice { network: string; cost: number; conversions: number; clicks: number }

/** Danh sách phủ định dùng chung (shared set) — để mô phỏng + đề xuất gắn/bổ sung. */
export interface SharedNegativeList {
  id: string
  name: string
  resourceName: string
  members: { text: string; match: string }[]
  /** Đang gắn vào chính chiến dịch của phiên chưa. */
  attached: boolean
}

export interface SearchEvidence {
  /** google_pmax dùng chung khung: keywords/ads rỗng, searchTerms lấy từ campaign_search_term_view. */
  kind: "google_search" | "google_pmax"
  company: Company
  range: { from: string; to: string }
  collectedAt: string
  campaign: SearchCampaignFacts
  conversionsByAction: ConversionByAction[]
  /** Hạng mục chuyển đổi mà chiến dịch đang dùng để đặt giá. */
  biddableCategories: string[]
  /** Số đơn Mua hàng ghi nhận ở các chiến dịch KHÁC cùng tài khoản — tag có chạy không. */
  purchasesElsewhere: number
  searchTerms: SearchTermFacts[]
  keywords: KeywordFacts[]
  negatives: { text: string; match: string }[]
  ads: { finalUrls: string[]; approval: string; strength: string }[]
  landingPages: { url: string; clicks: number; cost: number; conversions: number }[]
  /** Đơn mà CẢ tài khoản ghi được trên cùng trang đích (trang có sống không). */
  landingConversionsAccount: { url: string; conversions: number }[]
  sources: EvidenceSource[]
  /** Chỉ Pmax: chi phí/đơn theo kênh (Tìm kiếm, Hiển thị, YouTube…). */
  network?: NetworkSlice[]
  /** Danh sách phủ định dùng chung của tài khoản (loại NEGATIVE_KEYWORDS). */
  sharedLists?: SharedNegativeList[]
}

export interface Cause {
  id: string
  title: string
  detail: string
  /** VND liên quan; null = không tách riêng được (khuếch đại nguyên nhân khác). */
  money: number | null
  /** Tỉ trọng trên cơ sở ghi ở `shareOf`. */
  share: number | null
  shareOf: "campaign_cost" | "visible_terms" | null
  evidence: { label: string; value?: string; cost?: number; clicks?: number }[]
}

export interface CheckedOk { id: string; text: string }

export interface Diagnosis {
  causes: Cause[]
  notCauses: CheckedOk[]
  /** Phần chi phí từ khoá khách tìm thấy được / tổng chi phí chiến dịch. */
  visibleTermShare: number
  context: string[]
}

// ── Facebook (Đợt 3) ─────────────────────────────────────────

/** Sự kiện nhóm quảng cáo đang tối ưu. `custom` = sự kiện TỰ ĐẶT tên (custom_event_type OTHER). */
export interface MetaOptEvent {
  /** Enum Meta (PURCHASE, ADD_PAYMENT_INFO…) hoặc OTHER. */
  type: string
  /** Tên sự kiện tự đặt (custom_event_str), vd "add_payment_info". */
  customName: string | null
  label: string
  isPurchase: boolean
}

export interface MetaAdSetFacts {
  id: string
  name: string
  status: string
  effectiveStatus: string
  dailyBudget: number | null
  optimizationGoal: string
  optEvent: MetaOptEvent
  /** learning_stage_info: status LEARNING | SUCCESS | FAIL; conversions = số sự kiện tối ưu Meta đếm. */
  learning: { status: string | null; conversions: number | null; lastSigEditAt: string | null }
  /** Ảnh chụp targeting đầy đủ lúc thu thập (để tính loại vị trí; hoàn tác đọc lại lúc ghi). */
  targeting: Record<string, unknown>
  automaticPlacement: boolean
  cost: number
  impressions: number
  clicks: number
  frequency: number | null
  purchases: number
  purchaseValue: number
  /** Số kết quả theo sự kiện tối ưu (sự kiện tự đặt: gộp mọi sự kiện tự đặt — xem optResultsApprox). */
  optResults: number
  optResultsApprox: boolean
  /** Đợt 23 (3d): số lead (chiến dịch thu lead). Phiên cũ không có. */
  leads?: number
  /** Đợt 12: cài đặt ghi nhận của nhóm (Meta KHÔNG cho sửa sau khi tạo — đo 29/09). */
  attributionSpec?: { eventType: string; windowDays: number }[]
}

export interface MetaPlacementSlice {
  adsetId: string
  /** "facebook:facebook_reels" — khoá báo cáo, dịch sang targeting ở meta-placements.ts. */
  key: string
  label: string
  cost: number
  impressions: number
  clicks: number
  landingViews: number
  purchases: number
  optResults: number
  leads?: number
}

export interface MetaCampaignFacts {
  id: string
  name: string
  status: string
  effectiveStatus: string
  objective: string
  dailyBudget: number | null
  lifetimeBudget: number | null
  bidStrategy: string | null
  cost: number
  impressions: number
  reach: number
  frequency: number | null
  clicks: number
  linkClicks: number
  landingViews: number
  purchases: number
  purchaseValue: number
  /** Đợt 12: đơn Mua hàng theo cửa sổ — từ lượt bấm 7 ngày / chỉ xem 1 ngày. null = phiên cũ chưa đọc. */
  purchasesClick?: number | null
  purchasesView?: number | null
  /** Đợt 23 (3d): số lead (Meta "lead" gộp form + pixel). Phiên cũ không có. */
  leads?: number
  /** Mọi hành động Meta đếm được (đã gộp trùng omni/pixel), để xem phễu. */
  actions: { type: string; count: number; value: number }[]
}

export interface MetaEvidence {
  kind: "meta"
  company: Company
  range: { from: string; to: string }
  collectedAt: string
  campaign: MetaCampaignFacts
  adsets: MetaAdSetFacts[]
  placements: MetaPlacementSlice[]
  /** Đối chiếu Odoo qua utm_campaign trong liên kết quảng cáo. `checked=false` = không kiểm được. */
  odoo: { checked: boolean; tags: string[]; orders: number; revenue: number; note: string; readableAds?: number; unreadableAds?: number }
  /** Cùng công ty + cùng nhóm sản phẩm trong kỳ — để khuyên đổi sự kiện hay gộp. */
  peers: { campaigns: number; activeCampaigns: number; weeks: number; eventsPerWeek: Record<string, number> }
  /** Sự kiện trên pixel mà các nhóm của chiến dịch dùng — lượt 7 ngày gần nhất theo TÊN (Đợt 5: chọn sự kiện
   *  chuẩn cho nhóm mới). Thiếu = phiên cũ hoặc không đọc được. */
  pixel?: { pixelId: string; last7: Record<string, number> } | null
  sources: EvidenceSource[]
}

export type CaseEvidence = SearchEvidence | MetaEvidence
