// ============================================================
// AI Memory API — View memories & stats, trigger learning
// GET  /api/ai-memory — List memories + stats
// POST /api/ai-memory — Trigger learning cycle
// ============================================================

import { NextResponse } from "next/server";
import {
  getAllMemories,
  getMemoryStats,
  runLearningCycle,
  getLearningStats,
} from "@/lib/ai-memory-engine";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

// ─── GET — View memories & stats ───
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memories = getAllMemories();
  const stats = getMemoryStats();
  const learningStats = getLearningStats();

  return NextResponse.json({
    success: true,
    data: {
      memories,
      stats,
      learningStats,
    },
  });
}

// ─── POST — Trigger learning cycle ───
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = runLearningCycle();

    return NextResponse.json({
      success: true,
      message: `🧠 AI learned from ${result.memoriesCreated + result.memoriesUpdated} segments`,
      data: result,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: friendlyError(err instanceof Error ? err.message : "Unknown error"),
      },
      { status: 500 }
    );
  }
}
