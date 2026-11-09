// Đợt 24c — phiên bản bản cài: số trong package.json (tăng mỗi lần phát hành) + mã commit nếu máy chủ build cung cấp.
import pkg from "../package.json"
export const APP_VERSION: string = pkg.version
export function appCommit(): string | null {
  const c = process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || process.env.COOLIFY_GIT_COMMIT_SHA || ""
  return /^[0-9a-f]{7,40}$/i.test(c) ? c.slice(0, 7) : null
}
export const appVersionLabel = (): string => `v${APP_VERSION}${appCommit() ? ` (${appCommit()})` : ""}`
