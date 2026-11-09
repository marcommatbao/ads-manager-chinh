// Node.js-only half of instrumentation.
//
// Split out of instrumentation.ts because Turbopack bundles that file for the
// Edge runtime as well, and a bare `process.cwd()` in its body triggered an
// "A Node.js API is used ... not supported in the Edge Runtime" warning on
// every compile (147 lines of log noise per dev boot, which buried real
// errors). The runtime guard in instrumentation.ts is a runtime check, so it
// could not keep these calls out of the Edge bundle — only a dynamic import
// of a separate module can.
//
// Nothing here is edge-safe by design: it is only ever imported after
// instrumentation.ts has confirmed NEXT_RUNTIME === "nodejs".

export async function registerNode() {

  // ── Đợt 24c: phiên bản bản cài + phiên bản data/ (sao lưu rồi chuyển đổi nếu dữ liệu cũ hơn mã) — TRƯỚC mọi lần đọc data/ ──
  try {
    const { appVersionLabel } = await import("@/lib/version");
    const { ensureDataVersion, setDataVersionResult } = await import("@/lib/data-version");
    const path = (await import("path")).default;
    const r = await ensureDataVersion(path.join(process.cwd(), "data"));
    setDataVersionResult(r);
    const bad = r.status === "failed" || r.status === "newer";
    console.log(JSON.stringify({ level: bad ? "error" : "info", module: "startup", message: `AdsCommand ${appVersionLabel()} · dữ liệu v${r.to} (${r.status})`, ...(r.backup ? { backup: r.backup } : {}), ...(r.error ? { error: r.error } : {}) }));
  } catch (e) { console.error("[startup] data version", e); }

  // ── Đợt 21a: nạp danh sách công ty của bản cài (data/companies.json) vào sổ công ty dùng chung ─────────
  // Không chặn khởi động: tệp hỏng → giữ mặc định + lỗi hiện ở Cài đặt / tự kiểm.
  try {
    const { companiesConfigError, companyIds } = await import("@/lib/companies");
    const err = companiesConfigError();
    console.log(JSON.stringify({ level: err ? "warn" : "info", module: "startup", message: `Companies: ${companyIds().join(", ")}`, ...(err ? { error: err } : {}) }));
  } catch (e) { console.error("[startup] companies config", e); }
  // Đợt 21 A6: trình thiết lập lần đầu (SETUP_WIZARD=on chỉ ở bản cài mới cho khách; bản Mắt Bão phải là "off").
  try {
    const { setupEnabled, setupPending } = await import("@/lib/setup/state");
    console.log(JSON.stringify({ level: "info", module: "startup", message: `Setup wizard: ${setupEnabled() ? (setupPending() ? "on (chưa hoàn tất)" : "on (đã hoàn tất)") : "off"}` }));
  } catch (e) { console.error("[startup] setup state", e); }

  // Khôi phục quản trị viên (ADMIN_RECOVERY_*) — áp một lần cho mỗi cặp giá trị; không chặn khởi động.
  try {
    const { applyAdminRecovery } = await import("@/lib/team");
    await applyAdminRecovery();
  } catch (e) { console.error("[startup] admin recovery", e); }

  // ── 0. Verify DATA_ENCRYPTION_KEY is configured ─────────────────────────────
  // Deliberately NOT inside the non-fatal try/catch below: an app that can't
  // decrypt its own stored Meta/Google credentials should refuse to boot,
  // not silently continue as if everything is fine. This is the one
  // exception to this file's "never crash the server" rule — see
  // lib/crypto/data-encryption.ts for why plaintext fallback isn't acceptable.
  {
    const { assertEncryptionKeyConfigured } = await import("@/lib/crypto/data-encryption");
    try {
      assertEncryptionKeyConfigured();
    } catch (err) {
      console.error(
        "[instrumentation] FATAL: DATA_ENCRYPTION_KEY missing or invalid — refusing to boot with credentials at risk of plaintext storage. Generate one with: openssl rand -base64 32",
        err instanceof Error ? err.message : err
      );
      throw err;
    }
  }

  // ── 1. Backfill credentials from data/ ─────────────────────────────────────

  // ── 1. Khoá dán ở Cài đặt → API Keys (data/*-settings.json). Đợt 21 A4: gom về lib/settings/saved-credentials.ts
  //    (sửa 2 lỗi: Gemini/Telegram mã hoá mà không giải mã; mã khách hàng Google lệch chữ hoa). Biến môi trường vẫn thắng.
  try {
    const { applySavedCredentials } = await import("@/lib/settings/saved-credentials");
    const names = await applySavedCredentials();
    if (names.length) console.log(JSON.stringify({ level: "info", module: "startup", message: `Khoá từ Cài đặt: ${names.join(", ")}` }));
  } catch { /* non-fatal — instrumentation must not crash the server */ }

  // Chế độ cổng: nạp kết nối Meta (token từ cổng + tài khoản/Pixel/Trang đã chọn) vào process.env, làm mới định kỳ.
  // SAU bước nạp khoá đã lưu: kết nối qua cổng là nguồn đúng ở chế độ cổng.
  try {
    const { startMetaRuntime } = await import("@/lib/connect/meta-runtime");
    await startMetaRuntime();
  } catch (e) { console.error("[startup] connect meta", e); }

  // ── 2. Run startup checks ────────────────────────────────────────────────────

  try {
    const { runStartupChecks } = await import("@/lib/startup-check");
    runStartupChecks();
  } catch { /* non-fatal — startup checks must never crash the server */ }
}
