// POST /api/google/launch — deprecated shim
// Frontend now calls /search or /pmax directly.
// This endpoint exists only to return a clear error if called directly.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    {
      success: false,
      error: "Use /api/google/launch/search or /api/google/launch/pmax directly. " +
             "This dispatcher was removed to avoid Traefik self-call issues.",
    },
    { status: 400 }
  );
}
