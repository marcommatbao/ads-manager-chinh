// POST /api/meta/audience-compare/ai {company, ids[], from, to} — Đợt 26b: AI đánh giá bảng So sánh tệp đối tượng.
// Máy chủ TỰ dựng lại bảng (không tin số client gửi), chỉ đưa bảng đó cho Gemini, rồi soát từng con số AI viết ra.
// Đệm 10 phút theo (công ty, chiến dịch, khoảng ngày, giờ lấy số) — bấm lại không tốn thêm lượt AI.
import { NextRequest, NextResponse } from "next/server"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { parseRange } from "@/lib/case/dates"
import { rateLimit } from "@/lib/rate-limit"
import { callGemini } from "@/lib/gemini"
import { compareAudiences, CompareInputError } from "@/lib/meta/audience-compare-fetch"
import { getT } from "@/lib/i18n/server"
import { buildAssessPrompt, parseAssessment, unsupportedNumbers, type AiAssessment } from "@/lib/meta/audience-compare-ai"
import { friendlyError, isNotConfigured } from "@/lib/not-configured"
import { setCapped } from "@/lib/cost-guard"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const memo = new Map<string, { at: number; v: { assessment: AiAssessment; unsupported: number[]; fetchedAt: string } }>()

export async function POST(request: NextRequest) {
  // Soát bảo mật 07/10: mỗi lần là 1 lượt Gemini (+ có thể vài lượt Meta) → chỉ người có quyền sửa, tối đa 10 lần / 10 phút / người.
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const t = await getT()
  const rl = await rateLimit(`ai-assess:${u.value.id}`, 10, 600_000)
  if (!rl.allowed) return NextResponse.json({ success: false, error: t("libmeta.api.aiTooMany") }, { status: 429 })
  const b = (await request.json().catch(() => ({}))) as { company?: string; ids?: string[]; from?: string; to?: string }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  const pr = parseRange(b.from, b.to, { defaultDays: 30 })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  const ids = Array.isArray(b.ids) ? b.ids.map(String) : []
  try {
    const res = await compareAudiences(co.value, ids, { from: b.from!, to: b.to! })
    const rows = res.groups.reduce((n, g) => n + g.rows.length, 0)
    if (!rows) return NextResponse.json({ success: false, error: t("libmeta.api.noSpendAdsets") }, { status: 400 })
    const key = `${t("libmeta.localeTag")}|${co.value}|${[...ids].sort().join(",")}|${b.from}|${b.to}|${res.fetchedAt}`
    const hit = memo.get(key)
    if (hit && Date.now() - hit.at < 600_000) return NextResponse.json({ success: true, cached: true, ...hit.v })
    const ai = await callGemini(buildAssessPrompt(res.groups, res.range, t), { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json", thinkingBudget: 0, timeoutMs: 45_000 })
    const assessment = parseAssessment(ai.text ?? "")
    if (!assessment) return NextResponse.json({ success: false, error: t("libmeta.api.aiUnreadable") }, { status: 502 })
    const v = { assessment, unsupported: unsupportedNumbers(assessment, res.groups), fetchedAt: res.fetchedAt }
    setCapped(memo, key, { at: Date.now(), v })
    return NextResponse.json({ success: true, cached: false, ...v })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isNotConfigured(msg)) return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 400 })
    if (e instanceof CompareInputError || /^Chọn 2–|không thuộc công ty/.test(msg)) return NextResponse.json({ success: false, error: msg }, { status: 400 })
    return fail(e)
  }
}
