// POST /api/connectors/[id]/test — live test one connector
// Requires can_view_credentials (admin+)

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, isAdmin } from "@/lib/permissions";
import { runLiveCheck } from "@/lib/connectors/engine";
import { CONNECTORS_BY_ID } from "@/lib/connectors/registry";
import type { ConnectorId } from "@/lib/connectors/types";
import { friendlyError } from "@/lib/not-configured";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(user.role) /* Đợt 21 A4: can_view_credentials nay CHỈ super_admin (xem khoá). Tính năng này không phải khoá → giữ phạm vi cũ admin+. */) {
    return NextResponse.json({ error: "Không có quyền test kết nối" }, { status: 403 });
  }

  const { id } = await params;

  if (!(id in CONNECTORS_BY_ID)) {
    return NextResponse.json({ error: `Unknown connector: ${id}` }, { status: 400 });
  }

  const descriptor = CONNECTORS_BY_ID[id as ConnectorId];
  if (!descriptor.supportsLiveTest) {
    return NextResponse.json({
      error: `${descriptor.displayName} does not support live test — use the health snapshot instead`,
    }, { status: 400 });
  }

  try {
    const record = await runLiveCheck(id as ConnectorId);
    return NextResponse.json({ record });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: friendlyError(msg) }, { status: 500 });
  }
}
