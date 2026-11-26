import { NextRequest } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { runQualityCheckpoint } from "@/lib/jobs/quality-checkpoint"
export const dynamic = "force-dynamic"
export const maxDuration = 60
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/quality_checkpoint")
  if (!auth.ok) return auth.response
  // Keep history free of untrusted caller-provided identifiers.
  return runQualityCheckpoint(request.headers.has("x-manual-trigger") ? "manual" : "cron")
}
