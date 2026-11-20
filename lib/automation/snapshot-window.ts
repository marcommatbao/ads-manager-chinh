export const SNAPSHOT_TTL_MS = 15 * 60_000;

/** TTL starts with the earliest read, never with the last slow provider call. */
export function snapshotCollectionWindow(startedAt: Date, completedAt: Date) {
  const start = startedAt.getTime(), end = completedAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start >= SNAPSHOT_TTL_MS) throw new Error("SNAPSHOT_COLLECTION_EXPIRED");
  return {
    readAt: startedAt.toISOString(), collectedAt: completedAt.toISOString(),
    collectionDurationMs: end - start,
    expiresAt: new Date(start + SNAPSHOT_TTL_MS).toISOString(),
  };
}
