// GET /api/connect/meta/start?next=settings|setup — bắt đầu kết nối Facebook qua Cổng kết nối Mắt Bão (lib/connect/flow.ts).
import type { NextRequest } from "next/server"
import { startConnect } from "@/lib/connect/flow"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  return startConnect(req, "meta")
}
