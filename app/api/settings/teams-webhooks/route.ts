// GET  /api/settings/teams-webhooks — masked webhook links for leads_notify,
//      orders_notify, job_health_monitor
// POST /api/settings/teams-webhooks — save one or more (skip masked placeholders)
//
// Trước đây 3 webhook này chỉ đặt được qua biến môi trường (Coolify) —
// đổi link phải sửa code/nhờ AI/vào Coolify. Route này thêm đường thứ hai,
// quản lý ngay ở /settings/jobs, không cần redeploy.
//
// ƯU TIÊN: biến môi trường (nếu đã đặt) LUÔN thắng — giống mọi credential
// khác trong app (Meta/Google/Gemini/Telegram/Odoo, xem instrumentation.node.ts).
// Webhook đặt ở đây chỉ có tác dụng khi biến môi trường tương ứng CHƯA có.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { maskSecret, isMaskedPlaceholder } from "@/lib/settings/validators/credentials";
import { writeAuditEntry } from "@/lib/settings/audit";
import { guardViewCredentials, guardEditCredentials } from "@/lib/settings/guards";
import { encryptFields, decryptFields } from "@/lib/crypto/data-encryption";
import { withFileLock } from "@/lib/file-lock";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { isSafeWebhookUrl } from "@/lib/settings/webhook-url";
import { hasModule } from "@/lib/companies/registry";
import { patchFromSettings, setByInfra } from "@/lib/settings/env-origin";

const SETTINGS_PATH = path.resolve(process.cwd(), "data/teams-webhooks-settings.json");

// Khoá đúng bằng JobId của job gửi thẻ đó — 1 chỗ duy nhất định nghĩa cả 3,
// đọc/patch process.env đều lặp qua danh sách này thay vì if/else riêng lẻ.
const WEBHOOK_KEYS = [
  { key: "leads_notify",       envVar: "TEAMS_WEBHOOK_MATBAOIN",        label: "Lead mới — matbao.in", module: "matbao" },
  { key: "orders_notify",      envVar: "TEAMS_WEBHOOK_ORDERS_MATBAOIN", label: "Đơn hàng mới — matbao.in", module: "matbao" },
  { key: "job_health_monitor", envVar: "TEAMS_WEBHOOK_OPS_ALERTS",      label: "Cảnh báo hệ thống (Job Health Monitor)" },
  // Đợt 21 A4: mọi webhook Teams dán được ở Cài đặt (trước đây 3 cái dưới chỉ đặt được bằng biến môi trường)
  { key: "ads",                envVar: "TEAMS_WEBHOOK_ADS",             label: "Kênh Ads — kết quả đo bản tách, nhắc việc, báo cáo tuần, Hộp việc" },
  { key: "case_task",          envVar: "CASE_TASK_TEAMS_WEBHOOK",       label: "Nhắc việc phiên Xử lý chiến dịch" },
  { key: "measure_monitor",    envVar: "MEASURE_MONITOR_TEAMS_WEBHOOK", label: "Giám sát Sức khoẻ đo lường" },
  // Đợt 24a: 2 thẻ còn lại của Order Notify (trước chỉ đặt được ở Coolify). Bỏ trống = gửi chung vào webhook "Đơn hàng mới".
  { key: "orders_paid",        envVar: "TEAMS_WEBHOOK_PAID_MATBAOIN",      label: "Đơn đã thanh toán — matbao.in", module: "matbao" },
  { key: "orders_cancelled",   envVar: "TEAMS_WEBHOOK_CANCELLED_MATBAOIN", label: "Đơn huỷ — matbao.in", module: "matbao" },
] as const satisfies readonly { key: string; envVar: string; label: string; module?: "matbao" }[];

/** Ô hiện ở bản cài này — webhook gói Mắt Bão ẩn ở bản khách. */
const visibleKeys = () => WEBHOOK_KEYS.filter((w) => !("module" in w) || hasModule(w.module));

type WebhookKey = (typeof WEBHOOK_KEYS)[number]["key"];
type WebhookSettings = Partial<Record<WebhookKey, string>>;

const ENCRYPTED_FIELDS = WEBHOOK_KEYS.map(w => w.key) as WebhookKey[];

function readSettings(): WebhookSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as WebhookSettings;
      return decryptFields(raw, ENCRYPTED_FIELDS);
    }
  } catch { /* ignore */ }
  return {};
}

/** Vá process.env NGAY sau khi lưu — job chạy lượt kế tiếp (tối đa 10 phút
 *  sau với job_health_monitor) thấy giá trị mới liền, không cần chờ deploy.
 *  Chỉ vá khi biến môi trường CHƯA có — xem ghi chú ưu tiên ở đầu file. */
function patchEnv(settings: WebhookSettings): void {
  // Đợt 24a: biến do Cài đặt nạp trước đó được ghi đè (lưu lần 2 có hiệu lực ngay); biến của Coolify vẫn thắng.
  for (const w of WEBHOOK_KEYS) patchFromSettings(w.envVar, settings[w.key]);
}

/** Đợt 21 A4 (soát bảo mật): đọc để GHI — lỗi đọc / giải mã thì NÉM, không trả {} (trả {} rồi ghi = xoá sạch khoá đã lưu khác). */
function readSettingsForWrite(): ReturnType<typeof readSettings> {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  return decryptFields(raw, ENCRYPTED_FIELDS) as ReturnType<typeof readSettings>;
}

async function saveSettings(settings: WebhookSettings): Promise<{ persisted: boolean }> {
  return withFileLock(SETTINGS_PATH, async () => {
    const existing = readSettingsForWrite();
    const merged = { ...existing, ...settings };
    patchEnv(merged);
    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      const toWrite = encryptFields(merged, ENCRYPTED_FIELDS);
      writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2));
      return { persisted: true };
    } catch (e) {
      console.warn("[settings/teams-webhooks] Could not persist to disk:", e);
      return { persisted: false };
    }
  });
}

// GET — masked values; never expose raw webhook links
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credGuard = guardViewCredentials(user);
  if (credGuard) return credGuard;

  const saved = readSettings();
  return NextResponse.json({
    ok: true,
    webhooks: visibleKeys().map(w => {
      const raw = setByInfra(w.envVar) ? process.env[w.envVar] ?? "" : saved[w.key] || process.env[w.envVar] || "";
      return {
        key: w.key,
        label: w.label,
        value: maskSecret(raw),
        connected: !!raw,
        // "settings" = đang chạy bằng giá trị lưu ở đây — ƯU TIÊN kiểm tra file
        // TRƯỚC process.env: patchEnv() ở saveSettings() vá thẳng vào
        // process.env ngay khi lưu (để job chạy lượt kế tiếp thấy liền, không
        // cần đợi khởi động lại), nên process.env luôn "có giá trị" sau khi
        // lưu — nếu đọc process.env trước sẽ báo NHẦM "biến môi trường" cho
        // chính giá trị vừa lưu ở đây. "env" chỉ đúng khi KHÔNG có gì trong
        // file mà process.env vẫn có — tức chắc chắn tới từ Coolify.
        // "none" = chưa cấu hình đường nào.
        source: setByInfra(w.envVar) ? "env" : saved[w.key] ? "settings" : raw ? "env" : "none",
      };
    }),
  });
}

// POST — skip masked placeholder (client echoed it back unchanged)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const editGuard = guardEditCredentials(user);
  if (editGuard) return editGuard;

  const body = await request.json() as Partial<Record<string, string>>;

  const settings: WebhookSettings = {};
  for (const w of visibleKeys()) {
    const v = body[w.key];
    if (typeof v === "string" && v.trim() && !isMaskedPlaceholder(v)) {
      // Đợt 21 A4 (soát bảo mật): máy chủ sẽ POST vào URL này → chỉ nhận https (không http, không địa chỉ nội bộ dạng tự do).
      if (!isSafeWebhookUrl(v.trim())) return NextResponse.json({ ok: false, error: `${w.label}: phải là đường dẫn https:// tới tên miền công khai (webhook Teams / Power Automate) — không nhận địa chỉ IP hay máy nội bộ` }, { status: 400 });
      settings[w.key] = v.trim();
    }
  }

  if (Object.keys(settings).length === 0) {
    return NextResponse.json({ ok: true, message: "Không có thay đổi mới nào để lưu.", persisted: false });
  }

  let persisted: boolean;
  try { ({ persisted } = await saveSettings(settings)); }
  catch { return NextResponse.json({ ok: false, error: "Không đọc / giải mã được khoá đã lưu (khoá mã hoá DATA_ENCRYPTION_KEY đã đổi hoặc tệp hỏng) — KHÔNG ghi đè để khỏi mất các khoá khác. Liên hệ quản trị." }, { status: 500 }); }

  await writeAuditEntry(
    "credentials_teams_webhooks", user, "update",
    Object.keys(settings).join(", "),
    null, null, "ALL",
  );

  // Nói rõ nếu vừa lưu một webhook mà biến môi trường đang ghi đè — người
  // dùng bấm Lưu, thấy "đã lưu" nhưng job vẫn dùng link CŨ (từ Coolify) thì
  // sẽ tưởng tính năng hỏng.
  const overriddenByEnv = WEBHOOK_KEYS.filter(w => w.key in settings && setByInfra(w.envVar) && process.env[w.envVar] !== settings[w.key]);
  const message = !persisted
    ? "Áp dụng tạm (in-memory). Ghi đĩa thất bại — sẽ mất khi khởi động lại."
    : overriddenByEnv.length > 0
      ? `Đã lưu, nhưng biến môi trường Coolify (${overriddenByEnv.map(w => w.envVar).join(", ")}) đang ưu tiên hơn — gỡ biến đó ở Coolify để link vừa lưu có tác dụng.`
      : "Đã lưu webhook Teams — có hiệu lực ngay, không cần deploy lại.";

  return NextResponse.json({ ok: true, message, persisted, overriddenByEnv: overriddenByEnv.map(w => w.envVar) });
}
