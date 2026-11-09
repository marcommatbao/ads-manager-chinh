// ============================================================
// Hướng dẫn xử lý THỦ CÔNG cho từng loại đề xuất cải tiến.
// ------------------------------------------------------------
// Tách ra khỏi app/(dashboard)/improvements/page.tsx ngày 16/09/2026.
//
// Vì sao: bộ hướng dẫn chi tiết cho 14 loại đề xuất này đã được viết đầy đủ —
// từng bước cụ thể trong Google/Meta Ads Manager, link công cụ nội bộ — nhưng
// component dùng nó (`ManualGuideModal`) KHÔNG được gọi ở đâu cả sau một đợt
// refactor. Trang thật dùng ActionPlanPanel, mà bộ sinh của nó chỉ xử lý cụ
// thể 4/14 loại; 9 loại còn lại rơi vào một khối chung luôn in đúng ba dòng:
//   "Truy cập trình quản lý quảng cáo. Tìm campaign X. Thực hiện thay đổi
//    được yêu cầu."
// Người dùng bấm "Xem & Sửa" cho 9/14 loại chỉ nhận bấy nhiêu, trong khi
// hướng dẫn thật nằm ngay trong repo.
//
// Nằm ở lib thì CẢ HAI nơi dùng được: modal cũ (nếu nối lại) và ActionPlanPanel.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { makeT, type TFunction } from "@/lib/i18n/translate"

export interface ManualGuide {
  whatToDo:  string          // 1 câu tóm tắt
  steps:     string[]        // bước thực hiện
  internalLink?: string      // link tool nội bộ
  internalLabel?: string
  externalHint?: string      // gợi ý platform bên ngoài
}

export function getManualGuide(imp: any, t: TFunction = makeT("vi")): ManualGuide {
  const camp = imp.campaignName ? `"${imp.campaignName}"` : t("libcase.r.mg.1")
  const kw   = imp.keyword      ? `"${imp.keyword}"`      : t("libcase.r.mg.2")

  // Tiêu đề đề xuất do máy chủ sinh bằng tiếng Việt — tách cụm từ tìm kiếm ra khỏi tiền tố (so khớp CHỮ GỐC, không dịch).
  const searchTermOf = imp.title?.replace("Negative từ khóa không liên quan: ", "").replace("Negative search term không liên quan: ", "").replace(/"/g, "")

  switch (imp.type) {

    case "FIX_LOW_QS_KEYWORD":
      return {
        whatToDo: t("libcase.r.mg.3", { v1: kw, v2: imp.currentMetric, v3: imp.targetMetric }),
        steps: [
          t("libcase.r.mg.4", { v1: camp, v2: kw }),
          t("libcase.r.mg.5"),
          t("libcase.r.mg.6"),
          t("libcase.r.mg.7"),
          t("libcase.r.mg.8"),
        ],
        internalLink:  "/creative",
        internalLabel: t("libcase.r.mg.9"),
        externalHint:  t("libcase.r.mg.10"),
      }

    case "PAUSE_FB_AD_LOW_CTR":
      return {
        whatToDo: t("libcase.r.mg.11"),
        steps: [
          t("libcase.r.mg.12", { v1: camp }),
          t("libcase.r.mg.13", { v1: imp.adName || imp.title }),
          t("libcase.r.mg.14"),
          t("libcase.r.mg.15"),
          t("libcase.r.mg.16"),
          t("libcase.r.mg.17"),
          t("libcase.r.mg.18"),
        ],
        internalLink:  "/creative",
        internalLabel: t("libcase.r.mg.19"),
        externalHint:  "Meta Ads Manager → Ads → Filter by CTR",
      }

    case "PAUSE_FB_AD_FATIGUE":
      return {
        whatToDo: t("libcase.r.mg.20"),
        steps: [
          t("libcase.r.mg.21", { v1: imp.adGroupName }),
          t("libcase.r.mg.22"),
          t("libcase.r.mg.23"),
          t("libcase.r.mg.24"),
          t("libcase.r.mg.25"),
        ],
        internalLink:  "/creative",
        internalLabel: t("libcase.r.mg.19"),
        externalHint:  t("libcase.r.mg.26"),
      }

    case "DAYPART_OPPORTUNITY":
      return {
        whatToDo: t("libcase.r.mg.27"),
        steps: [
          t("libcase.r.mg.28"),
          t("libcase.r.mg.29"),
          t("libcase.r.mg.30"),
          t("libcase.r.mg.31"),
          t("libcase.r.mg.32"),
        ],
        internalLink:  "/toolkit/dayparting",
        internalLabel: t("libcase.r.mg.33"),
      }

    case "FIX_AD_STRENGTH":
    case "IMPROVE_PMAX_ASSETS":
      return {
        whatToDo: t("libcase.r.mg.34"),
        steps: [
          t("libcase.r.mg.35"),
          t("libcase.r.mg.36"),
          t("libcase.r.mg.37"),
          t("libcase.r.mg.38"),
          t("libcase.r.mg.39"),
          t("libcase.r.mg.40"),
        ],
        internalLink:  `/creative${imp.resourceName ? `?adResource=${imp.resourceName}` : ""}`,
        internalLabel: t("libcase.r.mg.41"),
        externalHint:  t("libcase.r.mg.42"),
      }

    case "ADD_AD_EXTENSION":
      return {
        whatToDo: t("libcase.r.mg.43"),
        steps: [
          t("libcase.r.mg.44", { v1: camp }),
          t("libcase.r.mg.45"),
          t("libcase.r.mg.46"),
          t("libcase.r.mg.47"),
          t("libcase.r.mg.48"),
          t("libcase.r.mg.49"),
        ],
        externalHint: t("libcase.r.mg.50"),
      }

    case "GEO_BID_ADJUSTMENT":
      return {
        whatToDo: t("libcase.r.mg.51"),
        steps: [
          t("libcase.r.mg.52", { v1: camp }),
          t("libcase.r.mg.53"),
          t("libcase.r.mg.54"),
          t("libcase.r.mg.55"),
          t("libcase.r.mg.56"),
        ],
        externalHint: t("libcase.r.mg.57"),
      }

    case "DEVICE_BID_ADJUSTMENT":
      return {
        whatToDo: t("libcase.r.mg.58"),
        steps: [
          t("libcase.r.mg.59", { v1: camp }),
          t("libcase.r.mg.60"),
          t("libcase.r.mg.step3mobile", { v1: imp.targetMetric || t("libcase.r.mg.bidDefault") }),
          t("libcase.r.mg.61"),
          t("libcase.r.mg.62"),
        ],
      }

    case "ADD_EXACT_MATCH":
      return {
        whatToDo: t("libcase.r.mg.63"),
        steps: [
          t("libcase.r.mg.64", { v1: camp }),
          t("libcase.r.mg.65", { v1: imp.keyword }),
          t("libcase.r.mg.66", { v1: imp.keyword }),
          t("libcase.r.mg.67"),
          t("libcase.r.mg.68"),
          t("libcase.r.mg.69"),
        ],
        externalHint: t("libcase.r.mg.70"),
      }

    case "PAUSE_SEARCH_TERM":
    case "NEGATIVE_BRAND_LEAK":
      return {
        whatToDo: t("libcase.r.mg.71"),
        steps: [
          t("libcase.r.mg.72", { v1: camp }),
          t("libcase.r.mg.73"),
          t("libcase.r.mg.74", { v1: searchTermOf }),
          t("libcase.r.mg.75"),
          t("libcase.r.mg.76"),
        ],
        externalHint: t("libcase.r.mg.77"),
      }

    case "INCREASE_BUDGET_CAPPED":
      return {
        whatToDo: t("libcase.r.mg.78"),
        steps: [
          t("libcase.r.mg.79", { v1: camp, v2: imp.currentMetric?.match(/\d+%/)?.[0] || "" }),
          t("libcase.r.mg.80"),
          t("libcase.r.mg.81", { v1: imp.targetMetric }),
          t("libcase.r.mg.82"),
          t("libcase.r.mg.83"),
        ],
      }

    case "LOWER_TARGET_CPA":
      return {
        whatToDo: t("libcase.r.mg.84"),
        steps: [
          t("libcase.r.mg.85", { v1: camp }),
          t("libcase.r.mg.86"),
          t("libcase.r.mg.87", { v1: imp.targetMetric }),
          t("libcase.r.mg.88"),
          t("libcase.r.mg.89"),
        ],
      }

    case "INCREASE_BID_HIGH_ROAS":
      return {
        whatToDo: t("libcase.r.mg.90"),
        steps: [
          t("libcase.r.mg.91", { v1: kw, v2: camp }),
          t("libcase.r.mg.92"),
          t("libcase.r.mg.93"),
          t("libcase.r.mg.94"),
          t("libcase.r.mg.95"),
        ],
      }

    case "DUPLICATE_FB_WINNING_ADSET":
      return {
        whatToDo: t("libcase.r.mg.96"),
        steps: [
          t("libcase.r.mg.97", { v1: imp.adGroupName }),
          t("libcase.r.mg.98"),
          t("libcase.r.mg.99"),
          t("libcase.r.mg.100"),
          t("libcase.r.mg.101"),
        ],
        externalHint: "Meta Ads Manager → Ad Sets → Duplicate",
      }

    // ── Bảy loại dưới đây TRƯỚC ĐÂY KHÔNG CÓ hướng dẫn riêng (viết 16/09/2026).
    //    Chúng rơi vào nhánh default và chỉ in lại currentMetric/targetMetric —
    //    trong đó PAUSE_KEYWORD là một trong những loại xuất hiện nhiều nhất.

    case "PAUSE_KEYWORD":
      return {
        whatToDo: t("libcase.r.mg.102", { v1: kw }),
        steps: [
          t("libcase.r.mg.103", { v1: camp }),
          t("libcase.r.mg.104", { v1: kw, v2: imp.currentMetric || t("libcase.r.mg.seeCol1") }),
          t("libcase.r.mg.105"),
          t("libcase.r.mg.106"),
          t("libcase.r.mg.107"),
        ],
        externalHint: t("libcase.r.mg.108"),
      }

    case "PAUSE_LOW_CTR_AD":
      return {
        whatToDo: t("libcase.r.mg.109", { v1: camp }),
        steps: [
          t("libcase.r.mg.110", { v1: camp }),
          t("libcase.r.mg.111", { v1: imp.currentMetric || t("libcase.r.mg.seeCol2") }),
          t("libcase.r.mg.112"),
          t("libcase.r.mg.113"),
          t("libcase.r.mg.114"),
        ],
        externalHint: t("libcase.r.mg.115"),
      }

    case "PAUSE_PMAX_ASSET":
      return {
        whatToDo: t("libcase.r.mg.116", { v1: camp }),
        steps: [
          t("libcase.r.mg.117", { v1: camp }),
          t("libcase.r.mg.118"),
          t("libcase.r.mg.119"),
          t("libcase.r.mg.120"),
          t("libcase.r.mg.121"),
        ],
        internalLink: "/google-pmax",
        internalLabel: t("libcase.r.mg.122"),
      }

    case "SHIFT_BUDGET_CHANNEL":
      return {
        whatToDo: t("libcase.r.mg.123"),
        steps: [
          t("libcase.r.mg.124"),
          t("libcase.r.mg.125"),
          t("libcase.r.mg.126"),
          t("libcase.r.mg.127"),
        ],
        internalLink: "/toolkit/budget-pacing",
        internalLabel: t("libcase.r.mg.128"),
      }

    case "RAISE_BUDGET_TOP_CAMPAIGN":
      return {
        whatToDo: t("libcase.r.mg.129", { v1: camp }),
        steps: [
          t("libcase.r.mg.130"),
          t("libcase.r.mg.131"),
          t("libcase.r.mg.132"),
          t("libcase.r.mg.133"),
        ],
        internalLink: "/toolkit/budget-pacing",
        internalLabel: t("libcase.r.mg.128"),
      }

    case "ADD_COMPETITOR_KW":
      return {
        whatToDo: t("libcase.r.mg.134", { v1: camp }),
        steps: [
          t("libcase.r.mg.135"),
          t("libcase.r.mg.136"),
          t("libcase.r.mg.137"),
          t("libcase.r.mg.138"),
          t("libcase.r.mg.139"),
        ],
        externalHint: t("libcase.r.mg.140"),
      }

    case "EXPAND_REMARKETING":
      return {
        whatToDo: t("libcase.r.mg.141", { v1: camp }),
        steps: [
          t("libcase.r.mg.142"),
          t("libcase.r.mg.143"),
          t("libcase.r.mg.144"),
          t("libcase.r.mg.145"),
        ],
        internalLink: "/audiences",
        internalLabel: t("libcase.r.mg.146"),
      }

    default:
      return {
        whatToDo: imp.description || t("libcase.r.mg.147"),
        steps: [
          imp.currentMetric ? t("libcase.r.mg.148", { v1: imp.currentMetric }) : "",
          imp.targetMetric  ? t("libcase.r.mg.149", { v1: imp.targetMetric })  : "",
          imp.impact        ? t("libcase.r.mg.150", { v1: imp.impact })         : "",
        ].filter(Boolean),
      }
  }
}
