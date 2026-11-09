// ============================================================
// Ads Content — PDF Export
// ============================================================
// POST body: { items: CreativeItem[], month?: string, currency?: string, filters?: AdsContentFilters }
// Same contract as the Excel export route: client sends the
// already-filtered/selected item list it has in state. `filters` is
// only used to render an "applied filters" line for manager readability
// — it does not re-filter `items` server-side.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { groupByCampaign, type AdsContentFilters } from "@/lib/ads-content/filtering";
import { AdsContentPDF } from "@/lib/ads-content-pdf";
import type { CreativeItem } from "@/types/creative-content.types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let items: CreativeItem[];
  let month: string;
  let currency: string;
  let filters: Partial<AdsContentFilters> | undefined;
  try {
    const body = await req.json();
    items = Array.isArray(body.items) ? body.items : [];
    month = typeof body.month === "string" ? body.month : new Date().toISOString().slice(0, 7);
    currency = typeof body.currency === "string" ? body.currency : "VND";
    filters = body.filters && typeof body.filters === "object" ? body.filters : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const groups = groupByCampaign(items);

  const buffer = await renderToBuffer(AdsContentPDF({ month, groups, currency, filters }));

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ads-content-${new Date().toISOString().split("T")[0]}.pdf"`,
    },
  });
}
