// ============================================================
// GA4 property connections — storage for data/ga4-settings.json.
//
// Extracted from app/api/ga4/route.ts so non-route callers (the connector
// health check) can read real connection state without importing a route
// handler. Same file, same encrypted fields, same locking as before.
// ============================================================
import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { encryptFields, decryptFields } from "@/lib/crypto/data-encryption";
import type { GA4PropertyMapping } from "@/types/ads.types";

export const GA4_SETTINGS_PATH = path.resolve(process.cwd(), "data/ga4-settings.json");
const ENCRYPTED_FIELDS = ["accessToken", "refreshToken"] as const;

// encryptFields/decryptFields are generic over Record<string, unknown> —
// GA4PropertyMapping is a closed interface (no index signature), so it needs
// an explicit round-trip cast, same as every other field they touch
// structurally rather than nominally.
export function readGA4Connections(): GA4PropertyMapping[] {
  try {
    if (fs.existsSync(GA4_SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(GA4_SETTINGS_PATH, "utf8")) as GA4PropertyMapping[];
      return raw.map(
        (c) => decryptFields(c as unknown as Record<string, unknown>, ENCRYPTED_FIELDS) as unknown as GA4PropertyMapping,
      );
    }
  } catch { /* ignore — start empty */ }
  return [];
}

export function writeGA4Connections(configs: GA4PropertyMapping[]): void {
  fs.mkdirSync(path.dirname(GA4_SETTINGS_PATH), { recursive: true });
  const toWrite = configs.map((c) => encryptFields(c as unknown as Record<string, unknown>, ENCRYPTED_FIELDS));
  writeFileAtomicSync(GA4_SETTINGS_PATH, JSON.stringify(toWrite, null, 2));
}

/**
 * Read-modify-write under a lock, so two admins editing GA4 connections at
 * once cannot lose one another's write.
 */
export function mutateGA4Connections<T>(
  fn: (configs: GA4PropertyMapping[]) => { configs: GA4PropertyMapping[]; result: T },
): Promise<T> {
  return withFileLock(GA4_SETTINGS_PATH, async () => {
    const { configs, result } = fn(readGA4Connections());
    writeGA4Connections(configs);
    return result;
  });
}
