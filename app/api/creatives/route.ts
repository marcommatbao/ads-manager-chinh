// ============================================================
// Creative Library API Route — AdsCommand
// GET  /api/creatives
// POST /api/creatives  (create / update / link / learn)
// DELETE /api/creatives?id=xxx
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getAllCreatives,
  getCreativeById,
  saveCreative,
  deleteCreative,
  updateCreativeStatus,
  linkCreativeToCampaign,
  updateCreativePerformance,
  saveLearningInsight,
  generateCreativeId,
  parseCompanyFromName,
  type CreativeVariant,
} from "@/lib/creative-tracker";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, getCompaniesForRole, hasPermission } from "@/lib/permissions";
import { friendlyError } from "@/lib/not-configured";

function err(msg: string, code = 400) {
  return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: code });
}

// ─────────────────────────────────────────────
// GET — fetch all or one
// ─────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return err("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const status = searchParams.get("status");
  const company = searchParams.get("company");
  const product = searchParams.get("product");

  const allowed = getCompaniesForRole(user);

  if (id) {
    const c = getCreativeById(id);
    if (!c) return err("Creative not found", 404);
    if (c.company && !allowed.includes(c.company as string)) {
      return err("Access denied for this company", 403);
    }
    return NextResponse.json({ success: true, data: c });
  }

  let list = getAllCreatives().filter((c) => !c.company || allowed.includes(c.company as string));

  // Filter
  if (status && status !== "all") {
    list = list.filter((c) => c.status === status);
  }
  if (company && company !== "all") {
    list = list.filter((c) => c.company === company);
  }
  if (product) {
    list = list.filter((c) =>
      c.product.toLowerCase().includes(product.toLowerCase())
    );
  }

  return NextResponse.json({
    success: true,
    data: list,
    summary: {
      total: list.length,
      active: list.filter((c) => c.status === "active").length,
      draft: list.filter((c) => c.status === "draft").length,
      paused: list.filter((c) => c.status === "paused").length,
      retired: list.filter((c) => c.status === "retired").length,
    },
  });
}

// ─────────────────────────────────────────────
// POST — create / update / action
// ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return err("Unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON body");
  }

  const action = (body.action as string) || "create";

  // Audit 30/09: mọi thao tác ghi cần can_edit + quyền với công ty của bản ghi (trước đây chỉ cần đăng nhập →
  // viewer xoá / ghi đè được creative của công ty kia). "learn" ghi bài học chung, chỉ cần can_edit.
  if (!hasPermission(user.role, "can_edit")) return err("Không có quyền chỉnh sửa creative", 403);
  const targetId = action === "create" || action === "save"
    ? (body.creative as Partial<CreativeVariant> | undefined)?.id
    : (body as { id?: string }).id;
  const existing = targetId ? getCreativeById(String(targetId)) : undefined;
  if (existing?.company && !canAccessCompany(user, existing.company as string)) return err("Access denied for this company", 403);
  const newCompany = (action === "create" || action === "save") ? (body.creative as Partial<CreativeVariant> | undefined)?.company : undefined;
  if (newCompany && !canAccessCompany(user, newCompany as string)) return err("Access denied for this company", 403);

  // ── CREATE / SAVE TO LIBRARY ──────────────────────────
  if (action === "create" || action === "save") {
    const data = body.creative as Partial<CreativeVariant>;
    if (!data) return err("creative payload required");

    const creative: CreativeVariant = {
      id: data.id || generateCreativeId(),
      headline: data.headline || "",
      primary_text: data.primary_text || "",
      description: data.description || "",
      cta: data.cta || "Tìm hiểu thêm",
      tone_of_voice: data.tone_of_voice || [],
      product: data.product || "",
      segment: data.segment || "",
      platform: data.platform || "facebook",
      // Soát dữ liệu 07/10: thiếu điểm/dự đoán thì để trống — không bù điểm 5 hay CTR "1.5-2.5%".
      ai_quality_score: typeof data.ai_quality_score === "number" && data.ai_quality_score > 0 ? data.ai_quality_score : 0,
      predicted_ctr_range: typeof data.predicted_ctr_range === "string" ? data.predicted_ctr_range : "",
      status: data.status || "draft",
      created_at: data.created_at || new Date().toISOString(),
      generated_by: data.generated_by || "ai",
      company:
        data.company ||
        parseCompanyFromName(data.product || "") ||
        null,
      // optional link
      campaign_id: data.campaign_id,
      campaign_name: data.campaign_name,
      linked_at: data.linked_at,
      performance: data.performance,
    };

    const saved = await saveCreative(creative);
    return NextResponse.json({ success: true, data: saved });
  }

  // ── LINK TO CAMPAIGN ─────────────────────────────────
  if (action === "link") {
    const { id, campaign_id, campaign_name } = body as {
      id: string;
      campaign_id: string;
      campaign_name: string;
    };
    if (!id || !campaign_id) return err("id and campaign_id required");
    const updated = await linkCreativeToCampaign(
      id,
      campaign_id,
      campaign_name || campaign_id
    );
    if (!updated) return err("Creative not found", 404);
    return NextResponse.json({ success: true, data: updated });
  }

  // ── UPDATE STATUS ─────────────────────────────────────
  if (action === "status") {
    const { id, status } = body as {
      id: string;
      status: CreativeVariant["status"];
    };
    if (!id || !status) return err("id and status required");
    const updated = await updateCreativeStatus(id, status);
    if (!updated) return err("Creative not found", 404);
    return NextResponse.json({ success: true, data: updated });
  }

  // ── UPDATE PERFORMANCE ────────────────────────────────
  if (action === "performance") {
    const { id, performance } = body as {
      id: string;
      performance: Parameters<typeof updateCreativePerformance>[1];
    };
    if (!id || !performance) return err("id and performance required");
    const updated = await updateCreativePerformance(id, performance);
    if (!updated) return err("Creative not found", 404);
    return NextResponse.json({ success: true, data: updated });
  }

  // ── SAVE LEARNING INSIGHT ─────────────────────────────
  if (action === "learn") {
    const { tone, segment, learning, sample_ctr } = body as {
      tone: string;
      segment: string;
      learning: string;
      sample_ctr: number;
    };
    if (!tone || !learning) return err("tone and learning required");
    const insight = await saveLearningInsight(
      tone,
      segment || "general",
      learning,
      sample_ctr || 0
    );
    return NextResponse.json({ success: true, data: insight });
  }

  return err(`Unknown action: ${action}`);
}

// ─────────────────────────────────────────────
// DELETE — remove a creative
// ─────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return err("Unauthorized", 401);

  if (!hasPermission(user.role, "can_edit")) return err("Không có quyền xoá creative", 403);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("id is required");
  const existing = getCreativeById(id);
  if (existing?.company && !canAccessCompany(user, existing.company as string)) return err("Access denied for this company", 403);
  const ok = await deleteCreative(id);
  if (!ok) return err("Creative not found", 404);
  return NextResponse.json({ success: true });
}
