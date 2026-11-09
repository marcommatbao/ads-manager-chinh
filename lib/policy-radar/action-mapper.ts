// ─────────────────────────────────────────────
// Policy Radar — Recommended action + AdsCommand module mapping
// Deterministic per affected-area, short and operational (not legal text).
// ─────────────────────────────────────────────

import type { PolicyAffectedArea } from "./types";
import { isHiddenPage } from "@/lib/hidden-pages";

const AREA_ACTIONS: Record<PolicyAffectedArea, string[]> = {
  ad_copy: ["Rà soát ad copy đang chạy có còn đúng chính sách không"],
  landing_page: ["Kiểm tra landing page có claim/nội dung vi phạm không"],
  tracking_measurement: ["Audit lại tracking sự kiện purchase/conversion"],
  creative_ai: ["Rà soát creative do AI tạo trước khi launch, kiểm tra disclosure"],
  automation_rules: ["Tạm dừng auto-apply cho campaign nhạy cảm đến khi review xong"],
  account_health: ["Kiểm tra account health, xem có cảnh báo/hạn chế mới không"],
  targeting: ["Rà soát targeting hiện tại có dùng option sắp bị loại bỏ không"],
  reporting: ["Đối chiếu số liệu báo cáo có bị ảnh hưởng bởi thay đổi này không"],
  brand_identity: ["Kiểm tra ad có branding/tên thương hiệu rõ ràng không"],
  legal_review: ["Chuyển cho phụ trách pháp lý/tuân thủ rà soát nhanh"],
};

const AREA_MODULES: Record<PolicyAffectedArea, string[]> = {
  ad_copy: ["/creative", "/campaigns"],
  landing_page: ["/campaigns"],
  tracking_measurement: ["/reports", "/settings/tracking"],
  creative_ai: ["/creative", "/creative/analysis"],
  automation_rules: ["/automation"],
  account_health: ["/google-audit"],
  targeting: ["/audiences"],
  reporting: ["/reports"],
  brand_identity: ["/creative"],
  legal_review: [],
};

export function mapRecommendedActions(areas: PolicyAffectedArea[]): string[] {
  const actions = new Set<string>();
  for (const area of areas) {
    for (const action of AREA_ACTIONS[area]) actions.add(action);
  }
  return Array.from(actions);
}

export function mapAffectedModules(areas: PolicyAffectedArea[]): string[] {
  const modules = new Set<string>();
  for (const area of areas) {
    // Bỏ trang đang tạm ẩn (lib/hidden-pages.ts): chỉ sang một trang mà bấm
    // vào sẽ bị đá về Dashboard thì người đọc tưởng hệ thống hỏng.
    for (const mod of AREA_MODULES[area]) {
      if (!isHiddenPage(mod)) modules.add(mod);
    }
  }
  return Array.from(modules);
}
