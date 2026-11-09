// ============================================================
// Policy Radar — "Việc cần làm": gom mọi mục chưa xử lý thành MỘT danh sách
// hành động, xếp theo deadline, tách rõ ba làn.
// ------------------------------------------------------------
// Vì sao cần: Policy Radar đang tóm tắt TỪNG bài. Người dùng nói thẳng "có
// chính sách mà tôi không có thời gian đọc" — 16 thẻ, mỗi thẻ một tóm tắt, vẫn
// là 16 lần phải tự đọc rồi tự xâu chuỗi. Thứ thiếu là một người ngồi đọc hết
// rồi nói "chỉ 4 cái này cần làm, cái này trước ngày nào".
//
// BA LÀN, vì ba việc khác hẳn nhau:
//   account — bạn phải vào Google Ads / Meta bấm
//   tool    — phải sửa AdsCommand (code), người dùng không tự làm được
//   ignore  — không thuộc kênh/thị trường của mình, nói ra để khỏi mở đọc
//
// CHỐT CHI PHÍ (đặt ngay trong thiết kế, không phải thêm sau):
//   - MỘT lời gọi Gemini cho CẢ LÔ, không phải mỗi item một lời gọi
//   - trần số item đưa vào, trần độ dài mỗi item, trần maxOutputTokens
//   - thinkingBudget: 0 (bắt buộc với mọi lời gọi đòi JSON — xem lib/gemini)
//   - CHỈ chạy khi bấm nút. Không cron. Không tự chạy khi mở trang.
//   - kết quả lưu đĩa; bấm lại trong MIN_REBUILD_MS thì trả bản cũ
//
// CHỐT CHỐNG BỊA:
//   - mỗi hành động BẮT BUỘC neo vào sourceItemIds có thật; id lạ → loại bỏ
//   - deadline chỉ nhận ngày ISO hợp lệ; không suy đoán được thì null, kèm
//     deadlineNote trích từ bài. Không bao giờ tự chế một cái mốc.
// ============================================================

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { callGemini, callWithTimeout, extractJSON } from "@/lib/gemini";
import { log } from "@/lib/logger";
import type { PolicyRadarItem } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const PLAN_FILE = path.join(DATA_DIR, "policy-radar-action-plan.json");

/** Trần số mục đưa vào một lượt. Nhiều hơn thì lấy mục mới nhất — thà nói rõ
 *  "đã cắt" còn hơn nhồi hết vào rồi vượt cửa sổ ngữ cảnh và mất bài đầu. */
const MAX_ITEMS = 25;
/** Trần ký tự mỗi mục. Tiêu đề + vì sao quan trọng là đủ để xếp ưu tiên. */
const MAX_CHARS_PER_ITEM = 600;
const MAX_OUTPUT_TOKENS = 2048;
/** Bấm lại trong khoảng này thì trả bản đã lưu, không gọi Gemini lần nữa. */
const MIN_REBUILD_MS = 5 * 60 * 1000;

export type ActionLane = "account" | "tool" | "ignore";

export interface PolicyAction {
  /** Câu mệnh lệnh ngắn: làm gì. */
  title: string;
  lane: ActionLane;
  /** ISO yyyy-mm-dd. null = bài không nói mốc nào — KHÔNG được đoán. */
  deadline: string | null;
  /** Trích chỗ nói về thời điểm, để người đọc tự kiểm. Rỗng khi bài không nói. */
  deadlineNote: string;
  why: string;
  severity: "high" | "medium" | "low";
  /** Neo về mục có thật trong Policy Radar. Rỗng = bịa, sẽ bị loại. */
  sourceItemIds: string[];
}

export interface PolicyActionPlan {
  generatedAt: string;
  /** Số mục đã đưa vào lượt phân tích này. */
  itemCount: number;
  /** Vân tay của đúng bộ mục đã dùng — lệch với hiện tại = kế hoạch đã cũ. */
  itemsFingerprint: string;
  /** true khi có mục bị cắt khỏi lượt này vì vượt trần. */
  truncated: boolean;
  actions: PolicyAction[];
  /** Mục AI cho là không cần làm gì, kèm lý do — để người đọc khỏi mở ra xem. */
  ignored: Array<{ itemId: string; title: string; reason: string }>;
  /** Có giá trị khi không gọi được AI: kế hoạch rỗng nhưng nói rõ vì sao, thay
   *  vì hiện danh sách trống trông như "không có việc gì phải làm". */
  error: string | null;
}

export function fingerprintItems(items: PolicyRadarItem[]): string {
  const ids = items.map((i) => i.id).sort().join("|");
  return crypto.createHash("sha1").update(ids).digest("hex").slice(0, 12);
}

/** Mục "chưa xử lý" = chưa đọc hoặc đã đánh dấu cần theo dõi tiếp. */
export function selectOpenItems(items: PolicyRadarItem[]): PolicyRadarItem[] {
  return items
    .filter((i) => i.status === "unread" || i.status === "flagged_for_followup")
    .sort((a, b) => (b.publishedAt ?? b.discoveredAt).localeCompare(a.publishedAt ?? a.discoveredAt));
}

export async function readSavedPlan(): Promise<PolicyActionPlan | null> {
  try {
    return JSON.parse(await fs.readFile(PLAN_FILE, "utf-8")) as PolicyActionPlan;
  } catch {
    return null;
  }
}

async function savePlan(plan: PolicyActionPlan): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  await withFileLock(PLAN_FILE, async () => {
    await writeFileAtomic(PLAN_FILE, JSON.stringify(plan, null, 2));
  });
}

function compactItem(i: PolicyRadarItem): string {
  const body = [i.summaryShort, i.whyItMatters].filter(Boolean).join(" ").slice(0, MAX_CHARS_PER_ITEM);
  return [
    `id: ${i.id}`,
    `nền tảng: ${i.platform}`,
    `tiêu đề: ${i.title}`,
    `ngày đăng: ${i.publishedAt ?? "không rõ"}`,
    `mức: ${i.severity}`,
    `nhóm ảnh hưởng: ${i.affectedAreas.join(", ") || "không rõ"}`,
    `nội dung: ${body}`,
  ].join("\n");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Bối cảnh tài khoản — để AI biết cái gì là "bỏ qua được" với CHÍNH nơi này,
 *  thay vì liệt kê mọi thứ Google vừa công bố. */
const ACCOUNT_CONTEXT = `
Bối cảnh người dùng (dùng để quyết định mục nào bỏ qua được):
- Chạy Google Ads (Search + Performance Max) và Facebook Ads. KHÔNG chạy Shopping,
  KHÔNG chạy YouTube/Demand Gen/Display & Video 360, KHÔNG bán lẻ hàng hoá vật lý.
- Thị trường: chỉ Việt Nam. Không quảng cáo ở châu Âu, không quảng cáo tài chính.
- Sản phẩm: tên miền, hosting, email, Google Workspace, Microsoft 365, hoá đơn
  điện tử, chữ ký số. Không phải thương mại điện tử bán lẻ.
- Có một công cụ nội bộ (AdsCommand) gọi Google Ads API và Meta Marketing API để
  đọc số liệu, tạo campaign, sửa RSA, đổi ngân sách. Thay đổi nào đụng tới API
  hoặc tới cách tạo/sửa campaign bằng API thì thuộc làn "tool".
`.trim();

function buildPrompt(items: PolicyRadarItem[]): string {
  return `Bạn đang giúp một người quản lý quảng cáo KHÔNG CÓ THỜI GIAN đọc hết các bản tin chính sách.
Nhiệm vụ: đọc danh sách thay đổi dưới đây và trả về DANH SÁCH VIỆC CẦN LÀM đã gộp, xếp theo mức khẩn.

${ACCOUNT_CONTEXT}

QUY TẮC BẮT BUỘC:
1. Mỗi việc phải neo vào "sourceItemIds" là id CÓ THẬT trong danh sách dưới. Không được bịa id.
2. "deadline" chỉ điền khi trong nội dung có mốc thời gian RÕ RÀNG, định dạng yyyy-mm-dd.
   Không suy đoán, không ước lượng. Không có mốc thì để null và ghi "deadlineNote": "".
   Khi có mốc, "deadlineNote" trích lại đúng cụm nói về mốc đó.
3. "lane" chọn một trong ba:
   - "account": người dùng phải tự vào Google Ads/Meta thao tác (đổi match type, sửa
     campaign, thêm brand exclusion, bật/tắt cài đặt...).
   - "tool": phải SỬA PHẦN MỀM, người dùng không tự làm được. Bắt buộc chọn làn này khi
     thay đổi chạm tới bất kỳ điều nào sau đây — đây là làn hay bị bỏ sót nhất:
       * phiên bản Google Ads API / Meta API mới hoặc bị ngừng hỗ trợ (sunset, deprecation)
       * trường/tiêu chí API bị bỏ, bị đổi, hoặc trở thành bắt buộc khi tạo/sửa campaign
       * cách xác thực thay đổi (OAuth, refresh token, passkey, service account)
       * lệnh ghi qua API sẽ bắt đầu trả lỗi
   - "ignore": không liên quan tới bối cảnh trên — đưa vào mảng "ignored", KHÔNG đưa vào "actions".
4. GỘP các mục nói về cùng một thay đổi thành MỘT việc, liệt kê nhiều id trong sourceItemIds.
5. Viết bằng tiếng Việt, câu mệnh lệnh ngắn gọn, cụ thể.
6. CẤM đưa vào "actions" những việc chỉ là ĐỌC hoặc THEO DÕI: "đọc bài", "tìm hiểu",
   "theo dõi thêm", "đánh giá tác động", "cập nhật kiến thức". Người dùng lập danh sách
   này CHÍNH VÌ không có thời gian đọc — trả về một việc "đi đọc" là không giúp được gì.
   Mục chỉ giới thiệu công cụ/tính năng mới mà không bắt buộc làm gì → "ignored".
7. Mục mà nội dung không đủ để kết luận (tóm tắt rỗng, chỉ nói "nội dung trang đã thay đổi")
   → đưa vào "ignored" với lý do bắt đầu bằng "CẦN ĐỌC NGUỒN:" rồi nói rõ vì sao không kết
   luận được. Tuyệt đối không bịa ra việc phải làm từ một mục không đọc được.

Trả về JSON THUẦN, không kèm giải thích, đúng cấu trúc:
{
  "actions": [
    { "title": "...", "lane": "account|tool", "deadline": "yyyy-mm-dd|null",
      "deadlineNote": "...", "why": "...", "severity": "high|medium|low",
      "sourceItemIds": ["..."] }
  ],
  "ignored": [ { "itemId": "...", "reason": "..." } ]
}

DANH SÁCH THAY ĐỔI:
${items.map(compactItem).join("\n---\n")}`;
}

interface RawPlan {
  actions?: Array<Partial<PolicyAction> & { deadline?: string | null }>;
  ignored?: Array<{ itemId?: string; reason?: string }>;
}

/**
 * Dựng kế hoạch. CHỈ gọi từ đường có người bấm — không đặt vào cron.
 * @param force bỏ qua chốt MIN_REBUILD_MS (vẫn tốn một lời gọi Gemini).
 */
export async function buildActionPlan(
  allItems: PolicyRadarItem[],
  opts: { force?: boolean } = {},
): Promise<{ plan: PolicyActionPlan; reused: boolean }> {
  const open = selectOpenItems(allItems);
  const fingerprint = fingerprintItems(open);
  const saved = await readSavedPlan();

  // Bấm lại liên tục không được phép đốt token: cùng bộ mục + còn mới thì trả
  // bản cũ. `force` chỉ bỏ qua chốt thời gian, không bỏ qua việc tính tiền.
  if (
    saved &&
    !opts.force &&
    saved.itemsFingerprint === fingerprint &&
    Date.now() - new Date(saved.generatedAt).getTime() < MIN_REBUILD_MS
  ) {
    return { plan: saved, reused: true };
  }

  const used = open.slice(0, MAX_ITEMS);
  const truncated = open.length > used.length;

  if (used.length === 0) {
    const empty: PolicyActionPlan = {
      generatedAt: new Date().toISOString(),
      itemCount: 0,
      itemsFingerprint: fingerprint,
      truncated: false,
      actions: [],
      ignored: [],
      error: null,
    };
    await savePlan(empty);
    return { plan: empty, reused: false };
  }

  const byId = new Map(used.map((i) => [i.id, i]));

  try {
    const { result, timedOut } = await callWithTimeout(
      () =>
        callGemini(
          buildPrompt(used),
          {
            temperature: 0.2,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            // Bắt buộc: token suy nghĩ ăn vào maxOutputTokens → JSON bị cắt giữa
            // chừng và JSON.parse hỏng, biểu hiện ra ngoài thành "AI không trả lời".
            thinkingBudget: 0,
          },
        ),
      45_000,
    );
    if (timedOut) throw new Error("Gemini quá hạn 45 giây");
    if (!result?.text) throw new Error("Gemini không trả về nội dung");

    const raw = extractJSON(result.text) as RawPlan | null;
    if (!raw) throw new Error("Không đọc được JSON từ phản hồi AI");

    // ── Lọc chống bịa: id không có thật thì loại cả việc đó ──
    let droppedForBadIds = 0;
    const actions: PolicyAction[] = [];
    for (const a of raw.actions ?? []) {
      const ids = (a.sourceItemIds ?? []).filter((id: string) => byId.has(id));
      if (ids.length === 0) {
        droppedForBadIds++;
        continue;
      }
      const lane: ActionLane = a.lane === "tool" ? "tool" : "account";
      const deadline = typeof a.deadline === "string" && ISO_DATE.test(a.deadline) ? a.deadline : null;
      actions.push({
        title: String(a.title ?? "").slice(0, 200),
        lane,
        deadline,
        deadlineNote: deadline ? String(a.deadlineNote ?? "").slice(0, 300) : "",
        why: String(a.why ?? "").slice(0, 400),
        severity: a.severity === "high" || a.severity === "low" ? a.severity : "medium",
        sourceItemIds: ids,
      });
    }

    // Việc có deadline lên trước, gần nhất trước; không có deadline xếp sau
    // theo mức nghiêm trọng. Người không có thời gian cần biết "cái nào trước".
    const sevRank = { high: 0, medium: 1, low: 2 } as const;
    actions.sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return sevRank[a.severity] - sevRank[b.severity];
    });

    const ignored = (raw.ignored ?? [])
      .filter((x) => x.itemId && byId.has(x.itemId))
      .map((x) => ({
        itemId: x.itemId as string,
        title: byId.get(x.itemId as string)?.title ?? "",
        reason: String(x.reason ?? "").slice(0, 200),
      }));

    if (droppedForBadIds > 0) {
      log.warn("policy_action_plan", `Loại ${droppedForBadIds} việc do AI dẫn id không có thật`, {
        itemCount: used.length,
      });
    }

    const plan: PolicyActionPlan = {
      generatedAt: new Date().toISOString(),
      itemCount: used.length,
      itemsFingerprint: fingerprint,
      truncated,
      actions,
      ignored,
      error: null,
    };
    await savePlan(plan);
    log.info("policy_action_plan", `Dựng kế hoạch từ ${used.length} mục`, {
      actions: actions.length,
      ignored: ignored.length,
      truncated,
    });
    return { plan, reused: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("policy_action_plan", `Không dựng được kế hoạch: ${message}`, { itemCount: used.length });
    // Trả kế hoạch RỖNG KÈM LÝ DO, không trả danh sách trống trơn — trống trơn
    // đọc thành "không có việc gì phải làm", một câu hoàn toàn khác.
    const failed: PolicyActionPlan = {
      generatedAt: new Date().toISOString(),
      itemCount: used.length,
      itemsFingerprint: fingerprint,
      truncated,
      actions: [],
      ignored: [],
      error: message,
    };
    return { plan: failed, reused: false };
  }
}
