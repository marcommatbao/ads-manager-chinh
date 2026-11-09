// ============================================================
// GET    /api/intelligence/keys      — list SimilarWeb keys (masked)
// POST   /api/intelligence/keys      — add a key
// DELETE /api/intelligence/keys?id=  — remove a key
//
// The Intelligence page's SimilarWebKeyManager has always called this
// route, but it was never implemented — the key list rendered empty and
// "Thêm key" silently did nothing. Backing store already existed
// (lib/intelligence-store.ts); only this HTTP layer was missing.
//
// Keys are real API credentials, so they follow the same posture as
// app/api/settings/gemini: admin+ to view (masked only, never the raw
// secret), super_admin to mutate.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { guardViewCredentials, guardEditCredentials } from "@/lib/settings/guards";
import { maskSecret } from "@/lib/settings/validators/credentials";
import { getSWKeys, addSWKey, removeSWKey, getActiveSWKey } from "@/lib/intelligence-store";
import type { SimilarWebKey } from "@/lib/intelligence-config";

export const dynamic = "force-dynamic";

// SimilarWeb's free tier issues a key per Gmail account valid for 7 days.
const KEY_VALID_DAYS = 7;

/** Never ship the raw key to the browser — the UI only needs to tell keys apart. */
function toPublicKey(k: SimilarWebKey) {
  return {
    id: k.id,
    apiKey: maskSecret(k.apiKey),
    gmail: k.gmail,
    addedAt: k.addedAt,
    expiresAt: k.expiresAt,
    usageCount: k.usageCount,
    isActive: k.isActive,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guard = guardViewCredentials(user);
  if (guard) return guard;

  const keys = getSWKeys();
  const active = getActiveSWKey();

  return NextResponse.json({
    keys: keys.map(toPublicKey),
    activeKeyId: active?.id ?? null,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guard = guardEditCredentials(user);
  if (guard) return guard;

  let body: { apiKey?: string; gmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  const gmail = body.gmail?.trim();
  if (!apiKey || !gmail) {
    return NextResponse.json({ error: "Cần nhập cả Gmail và API key" }, { status: 400 });
  }

  // Reject a masked value echoed back from the list — it is not a real key.
  if (apiKey.includes("****")) {
    return NextResponse.json({ error: "Vui lòng dán API key thật, không phải giá trị đã che" }, { status: 400 });
  }

  if (getSWKeys().some((k) => k.apiKey === apiKey)) {
    return NextResponse.json({ error: "Key này đã tồn tại" }, { status: 409 });
  }

  const now = new Date();
  const key: SimilarWebKey = {
    id: `swk_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
    apiKey,
    gmail,
    addedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + KEY_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    usageCount: 0,
    isActive: true,
  };

  await addSWKey(key);
  return NextResponse.json({ success: true, key: toPublicKey(key) });
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guard = guardEditCredentials(user);
  if (guard) return guard;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Thiếu id" }, { status: 400 });

  if (!getSWKeys().some((k) => k.id === id)) {
    return NextResponse.json({ error: "Không tìm thấy key" }, { status: 404 });
  }

  await removeSWKey(id);
  return NextResponse.json({ success: true });
}
