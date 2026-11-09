// ============================================================
// Giá trị mẫu CÔNG KHAI (trong .env.example / mã nguồn) — production không được dùng làm khoá (audit 30/09)
// ============================================================
// Repo công khai → ai cũng đọc được các chuỗi này. Trước đây startup-check chỉ chặn đúng một chuỗi dev; nếu môi
// trường nào chép .env.example (NEXTAUTH_SECRET / CRON_SECRET mẫu), người ngoài tự ký được cookie super_admin và gọi
// được mọi /api/cron. Thêm giá trị mẫu mới vào .env.example thì thêm vào đây.
export const KNOWN_PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  "adscommand-dev-secret-do-not-use-in-production",
  "a_very_long_random_secret_string_at_least_32_chars",
  "another_random_secret_for_nextauth",
  "a_random_secret_for_cron_authorization",
  "run_openssl_rand_-base64_32_to_generate_this",
])

export const isPlaceholderSecret = (v: string | undefined | null): boolean => !!v && KNOWN_PLACEHOLDER_SECRETS.has(v.trim())
