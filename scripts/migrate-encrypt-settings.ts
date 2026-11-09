// ============================================================
// One-time migration: encrypt sensitive fields in data/meta-settings.json
// and data/google-settings.json in place.
//
// Run manually — NEVER automatically on boot:
//   npx tsx -r dotenv/config scripts/migrate-encrypt-settings.ts dotenv_config_path=.env.local
//
// Requires DATA_ENCRYPTION_KEY to be set (same key the running app uses).
// Idempotent: already-encrypted fields (marked __enc:true) are left
// untouched, so re-running this script is always safe.
//
// Backs up each file to <name>.json.pre-encryption-backup before writing —
// only on the FIRST run (won't overwrite a real pre-migration backup with
// an already-migrated copy on a second run).
// ============================================================

import fs from "fs";
import path from "path";
import {
  encryptFields,
  isEncryptedField,
  assertEncryptionKeyConfigured,
} from "../lib/crypto/data-encryption";

const DATA_DIR = path.resolve(process.cwd(), "data");

const TARGETS: { file: string; fields: readonly string[] }[] = [
  { file: "meta-settings.json", fields: ["accessToken", "appSecret"] },
  { file: "google-settings.json", fields: ["developerToken", "clientSecret", "refreshToken"] },
];

function migrateFile(fileName: string, fields: readonly string[]): void {
  const filePath = path.join(DATA_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    console.log(`  ${fileName}: does not exist — nothing to migrate.`);
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`  ${fileName}: FAILED to parse — skipping this file. (${err instanceof Error ? err.message : err})`);
    return;
  }

  const alreadyEncryptedCount = fields.filter((f) => isEncryptedField(data[f])).length;
  const toEncryptCount = fields.filter((f) => typeof data[f] === "string" && (data[f] as string).length > 0 && !isEncryptedField(data[f])).length;

  if (toEncryptCount === 0) {
    console.log(`  ${fileName}: ${alreadyEncryptedCount} field(s) already encrypted, 0 to migrate. Skipping.`);
    return;
  }

  const backupPath = `${filePath}.pre-encryption-backup`;
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, raw, "utf8");
    console.log(`  ${fileName}: backed up original to ${path.basename(backupPath)}`);
  } else {
    console.log(`  ${fileName}: backup already exists (${path.basename(backupPath)}) — not overwriting.`);
  }

  const encrypted = encryptFields(data, fields);
  fs.writeFileSync(filePath, JSON.stringify(encrypted, null, 2), "utf8");
  console.log(`  ${fileName}: ${toEncryptCount} field(s) encrypted, ${alreadyEncryptedCount} already were.`);
}

function main(): void {
  console.log("Migration: encrypt sensitive settings fields at rest\n");

  try {
    assertEncryptionKeyConfigured();
  } catch (err) {
    console.error("FATAL:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  for (const { file, fields } of TARGETS) {
    migrateFile(file, fields);
  }

  console.log("\nDone. Restart the app (or redeploy) so instrumentation.ts picks up the encrypted values on next boot.");
}

main();
