// ============================================================
// Alias route — /api/improvements/next-best-actions
// Đường dẫn project-consistent (cùng nhánh /improvements). Tái dùng
// nguyên handler của /api/next-best-action (không trùng logic).
// ============================================================

export { GET, POST } from "@/app/api/next-best-action/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
