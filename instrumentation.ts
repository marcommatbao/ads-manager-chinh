// Next.js instrumentation — runs once when the server starts (Node.js runtime only).
//
// Responsibilities (all implemented in ./instrumentation.node):
//   1. Backfill process.env from JSON settings files so credentials survive
//      container restarts without a full redeploy.
//   2. Run boot-time environment + safety checks (startup-check.ts).
//
// This file stays free of Node built-ins so the Edge bundle Turbopack builds
// from it is clean; the Node-only work lives behind the dynamic import below
// and is never pulled into the Edge graph.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNode } = await import("./instrumentation.node");
  await registerNode();
}
