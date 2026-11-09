// ============================================================
// GET /api/health — nhịp sống của app, dành cho phép kiểm TỪ BÊN NGOÀI
// ============================================================
// P5 cần một điểm chạm thoả ba điều kiện cùng lúc, mà không endpoint nào có
// sẵn thoả cả ba:
//
//  1. KHÔNG cần đăng nhập. Phép kiểm chạy ngoài container thì không có phiên
//     người dùng. Middleware đã cho mọi đường `/api` đi vòng qua xác thực
//     (middleware.ts:22), nên chỗ này phải tự giữ mình: TUYỆT ĐỐI không trả
//     ra thông tin nào mà người chưa đăng nhập không được biết.
//  2. RẺ. Không gọi Meta/Google/Odoo/Gemini, không đọc file. Một endpoint
//     health mà đi hỏi API bên ngoài sẽ báo "chết" mỗi khi bên đó chậm — rồi
//     người ta tắt chuông, đúng vết xe đã đổ với cảnh báo missing_config.
//  3. Chứng minh được là TIẾN TRÌNH NÀY còn sống, không phải Traefik trả hộ.
//     `uptimeSec` và `startedAt` chỉ có thể do chính tiến trình Node sinh ra.
//
// KHÔNG trả: tên biến môi trường, trạng thái kết nối, phiên bản thư viện, số
// liệu tài khoản. Ai cũng gọi được endpoint này.
// ============================================================

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STARTED_AT = new Date().toISOString();

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      // Mốc thời gian của tiến trình — nếu container vừa bị dựng lại thì số
      // này nhảy về gần 0, đủ để phép kiểm ngoài nhận ra "vừa restart".
      startedAt: STARTED_AT,
      uptimeSec: Math.round(process.uptime()),
      now: new Date().toISOString(),
    },
    {
      // Không để Traefik/trình duyệt nào cache lại một câu "ok" cũ — thứ đó
      // sẽ khiến app chết mà phép kiểm vẫn thấy xanh.
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
