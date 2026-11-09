// GET  /api/settings/ai-cost — đơn giá Gemini người dùng tự nhập + số token
//      ĐÃ ĐO THẬT tháng này (lib/gemini-usage.ts)
// POST /api/settings/ai-cost — lưu đơn giá
//
// KHÔNG tự đoán giá — gemini-3.5-flash không có bảng giá công khai đáng tin
// trong tay để bịa. Người dùng tự nhập đơn giá thật họ xem trong Google
// Cloud Console; app chỉ nhân với số token đã đo được, không phát minh số
// nào. Không phải credential (không phải secret) nên không mã hoá, khác
// pattern app/api/settings/gemini/route.ts.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getUsageSummary } from "@/lib/gemini-usage";
import { withFileLock } from "@/lib/file-lock";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";

const SETTINGS_PATH = path.resolve(process.cwd(), "data/ai-cost-settings.json");

interface CostSettings {
  /** Giá cho 1 TRIỆU token — khớp đơn vị Google Cloud thường công bố, dán
   *  thẳng từ trang giá vào không cần quy đổi. */
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  currency?: "VND" | "USD";
}

function readSettings(): CostSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as CostSettings;
    }
  } catch { /* ignore */ }
  return {};
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = readSettings();
  const usage = getUsageSummary();

  const hasPrice = settings.inputPricePerMillion !== undefined && settings.outputPricePerMillion !== undefined;
  const estimatedCost = hasPrice
    ? (usage.monthPromptTokens / 1_000_000) * settings.inputPricePerMillion!
      + (usage.monthCandidateTokens / 1_000_000) * settings.outputPricePerMillion!
    : null;

  return NextResponse.json({
    ok: true,
    settings,
    usage,
    // null = chưa nhập giá, KHÔNG PHẢI 0 đồng — hai chuyện khác hẳn nhau.
    estimatedCost,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Không phải secret nhưng vẫn là số liệu tài chính nội bộ — cùng mức
  // quyền với việc sửa ngân sách, không mở cho mọi role xem/sửa được.
  if (!hasPermission(user.role, "can_edit_credentials")) {
    return NextResponse.json({ error: "Bạn không có quyền chỉnh đơn giá AI" }, { status: 403 });
  }

  const body = await request.json() as Partial<CostSettings>;
  const inputPricePerMillion = Number(body.inputPricePerMillion);
  const outputPricePerMillion = Number(body.outputPricePerMillion);
  const currency = body.currency === "USD" ? "USD" : "VND";

  if (!Number.isFinite(inputPricePerMillion) || inputPricePerMillion < 0
    || !Number.isFinite(outputPricePerMillion) || outputPricePerMillion < 0) {
    return NextResponse.json({ error: "Đơn giá phải là số ≥ 0" }, { status: 400 });
  }

  const settings: CostSettings = { inputPricePerMillion, outputPricePerMillion, currency };

  await withFileLock(SETTINGS_PATH, async () => {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  });

  return NextResponse.json({ ok: true, message: "Đã lưu đơn giá." });
}
