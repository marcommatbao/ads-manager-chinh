// Run inside the canonical app container. Read-only: no DB/file writes or secrets.
import fs from "node:fs";
import path from "node:path";

const dataPath = path.resolve(process.argv[2] || "/app/data");
const result = {
  node: process.version,
  dataPath,
  exists: fs.existsSync(dataPath),
  sqliteBuiltin: false,
  sqliteVersion: null,
  dedicatedMount: false,
  mountFilesystem: null,
  persistenceAcrossRedeploy: "unverified_requires_host_volume_metadata_and_controlled_drill",
};
try {
  const { DatabaseSync } = await import("node:sqlite");
  // In-memory probe only; never opens the app coordinator database.
  const db = new DatabaseSync(":memory:");
  result.sqliteVersion = db.prepare("SELECT sqlite_version() AS version").get().version;
  result.sqliteBuiltin = true;
  db.close();
} catch {
  result.sqliteBuiltin = false;
}
try {
  const realPath = fs.realpathSync(dataPath);
  const unescapeMount = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map(line => {
    const [left, right] = line.split(" - ");
    return { target: unescapeMount(left.split(" ")[4]), filesystem: right?.split(" ")[0] };
  });
  const mount = mounts.filter(m => realPath === m.target || realPath.startsWith(m.target === "/" ? "/" : m.target + "/")).sort((a, b) => b.target.length - a.target.length)[0];
  result.dedicatedMount = Boolean(mount && mount.target !== "/");
  result.mountFilesystem = mount?.filesystem ?? null;
} catch {
  // Absence of mount metadata is not evidence of persistence.
}
console.log(JSON.stringify(result, null, 2));
if (!result.exists || !result.sqliteBuiltin) process.exitCode = 1;
