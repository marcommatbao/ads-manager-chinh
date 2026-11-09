// GET  /api/automation/rules — list all rules
// POST /api/automation/rules — create | toggle | delete | run
import { getT } from "@/lib/i18n/server";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany, getCompaniesForRole } from "@/lib/permissions";
import { canTouchRuleScope, defaultRuleCompany, ruleTouchesBudget } from "@/lib/automation-rule-permission";
import {
  getAllRules,
  getRuleById,
  createRule,
  toggleRule,
  deleteRule,
  runAutomationEngine,
  getExecutionLog,
} from "@/lib/automation-engine";
import { friendlyError } from "@/lib/not-configured";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Lọc theo công ty người dùng được phép. Bản cũ trả getAllRules() không
    // lọc, nên bất kỳ ai đăng nhập — kể cả viewer — đọc được toàn bộ rule và
    // hành động của CẢ HAI công ty.
    // rule.company === "all" là rule áp cho cả hai, chỉ ai có cả hai mới thấy.
    const rules = getAllRules().filter(r => {
      if (!r.company || r.company === "all") return getCompaniesForRole(user).length === 2;
      return canAccessCompany(user, r.company as string);
    });
    const executionLog = getExecutionLog();
    return NextResponse.json({ success: true, data: { rules, executionLog } });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: t("libcase.r.ar.1") }, { status: 403 });
  }

  // Thân request ở đây là { action, rule } chứ không phải rule trần — đọc đúng
  // chỗ, nếu không chốt quyền sẽ không bao giờ nổ mà vẫn trông như đã có.
  const draft = await request.clone().json().catch(() => ({}));

  // CHẶN GHI CHÉO CÔNG TY. Trường `rule.company` do client gửi tự do, mà trước
  // đây route chỉ kiểm can_edit/can_manage_budget — không kiểm công ty. Nghĩa
  // là admin_mbc tạo được rule company:"MBI" với hành động pause_campaign hoặc
  // đổi ngân sách; engine chạy theo lịch sẽ áp nó lên campaign THẬT của MBI.
  // Không cần biết campaignId nào — rule tự khớp theo điều kiện.
  //
  // Audit 30/09: bỏ trống company trước đây LỌT phép kiểm (chỉ kiểm khi có giá trị) trong khi engine coi rule
  // không company là "cả hai công ty". Nay: trống = "all" → chỉ ai có cả hai công ty; admin một công ty bỏ trống
  // thì rule được gán công ty của họ (xem action "create" bên dưới).
  if (draft?.action === "create" && !canTouchRuleScope(user, defaultRuleCompany(user, draft?.rule?.company))) {
    return NextResponse.json({
      success: false,
      error: t("libcase.r.ar.2", { v1: String(draft?.rule?.company ?? "cả hai công ty") }),
    }, { status: 403 });
  }

  if (ruleTouchesBudget(draft?.rule?.actions) && !hasPermission(user.role, "can_manage_budget")) {
    return NextResponse.json({
      success: false,
      error: t("libcase.r.ar.3"),
    }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = body;

  try {
    switch (action) {
      case "create": {
        const input = { ...(body.rule as Record<string, unknown>) };
        input.company = defaultRuleCompany(user, input.company);
        const rule = createRule(input as Parameters<typeof createRule>[0]);
        return NextResponse.json({ success: true, data: rule });
      }

      case "toggle": {
        const cur = getRuleById(body.id as string);
        if (cur && !canTouchRuleScope(user, cur.company)) {
          return NextResponse.json({ success: false, error: t("libcase.r.ar.4") }, { status: 403 });
        }
        if (cur && !cur.isActive && ruleTouchesBudget(cur.actions) && !hasPermission(user.role, "can_manage_budget")) {
          return NextResponse.json({ success: false, error: t("libcase.r.ar.3") }, { status: 403 });
        }
        const toggled = toggleRule(body.id as string);
        if (!toggled) {
          return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
        }
        return NextResponse.json({ success: true, data: toggled });
      }

      case "delete": {
        const cur = getRuleById(body.id as string);
        if (cur && !canTouchRuleScope(user, cur.company)) {
          return NextResponse.json({ success: false, error: t("libcase.r.ar.4") }, { status: 403 });
        }
        const deleted = deleteRule(body.id as string);
        if (!deleted) {
          return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
        }
        return NextResponse.json({ success: true });
      }

      case "run": {
        // Chạy ngay = chạy MỌI rule đang bật của CẢ HAI công ty → chỉ người có cả hai công ty.
        if (getCompaniesForRole(user).length !== 2) {
          return NextResponse.json({ success: false, error: t("libcase.r.ar.5") }, { status: 403 });
        }
        const results = await runAutomationEngine();
        return NextResponse.json({ success: true, data: results });
      }

      case "log": {
        const log = getExecutionLog();
        return NextResponse.json({ success: true, data: log });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${String(action)}` },
          { status: 400 }
        );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
