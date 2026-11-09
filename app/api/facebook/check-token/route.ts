// GET /api/facebook/check-token
// Verify META_ACCESS_TOKEN validity using /me (works for all token types)
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.json({ valid: false, expiresIn: 0, warning: false, error: "No token configured" });
  }

  try {
    // Use /me endpoint — works for all token types regardless of issuing app
    const res = await fetch(
      `${META_GRAPH_BASE}/me?fields=id,name&access_token=${token}`
    );
    const data = await res.json() as { id?: string; name?: string; error?: { message: string; code: number } };

    if (data.error || !data.id) {
      return NextResponse.json({ valid: false, expiresIn: 0, warning: false, error: data.error?.message });
    }

    // Token is valid. Long-lived system user tokens never expire (expires_at = 0).
    return NextResponse.json({
      valid: true,
      expiresIn: 999 * 86400,
      warning: false,
      neverExpires: true,
      userName: data.name,
    });
  } catch {
    return NextResponse.json({ valid: false, expiresIn: 0, warning: false, error: "Network error" });
  }
}
