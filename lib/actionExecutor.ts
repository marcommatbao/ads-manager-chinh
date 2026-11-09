import { ActionPlan, ActionStep, Platform } from "@/types/improvements";

export async function executeStep(
  step: ActionStep,
  company: string
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const res = await fetch("/api/improvements/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: step.id,
        improvementId: step.id.split("-")[0],
        type: step.type,
        action: step.type, // Map it to action for backend compatibility
        company,
        ...step.payload,
      }),
    });

    const json = await res.json();
    if (res.ok && json.success) {
      return { success: true, result: json };
    } else {
      return { success: false, error: json.error || "Lỗi cập nhật" };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function executeActionPlan(
  plan: ActionPlan,
  company: string,
  onProgress: (stepId: string, status: "applying" | "done" | "failed") => void
): Promise<{ success: boolean; appliedSteps: string[]; failedSteps: string[] }> {
  
  const appliedSteps: string[] = [];
  const failedSteps: string[] = [];
  const autoSteps = plan.steps.filter((s) => s.canAutoApply);

  for (const step of autoSteps) {
    onProgress(step.id, "applying");

    // We can save history here to /api/improvements/snapshots if implemented
    const result = await executeStep(step, company);

    if (result.success) {
      appliedSteps.push(step.id);
      onProgress(step.id, "done");
    } else {
      failedSteps.push(step.id);
      onProgress(step.id, "failed");
    }
    
    // Slight delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    success: failedSteps.length === 0,
    appliedSteps,
    failedSteps,
  };
}

export async function handleUndo(plan: ActionPlan, company: string) {
  // Simple backend fallback undo for now, since snapshots aren't fully implemented
  await fetch("/api/improvements/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      improvementId: plan.improvementId,
      company,
      undo: true,
    }),
  });
}
