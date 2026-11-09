// /oauth/authorize — trang ĐỒNG Ý khi nối Claude (claude.ai Connectors, Claude Code/Desktop) vào AdsCommand qua OAuth.
// Middleware bắt đăng nhập trước (giữ nguyên tham số). Người dùng chọn Chỉ đọc / Đọc + Ghi; khoá cấp ra mang đúng quyền họ.
import { getCurrentUser } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"
import { getT } from "@/lib/i18n/server"
import { OAuthError, validateAuthorize } from "@/lib/mcp/oauth"

export const dynamic = "force-dynamic"

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const t = await getT()
  const user = await getCurrentUser()
  const p = {
    clientId: sp.client_id ?? "", redirectUri: sp.redirect_uri ?? "", state: sp.state ?? "",
    codeChallenge: sp.code_challenge ?? "", method: sp.code_challenge_method ?? "", responseType: sp.response_type ?? "",
  }
  let clientName = ""
  let error = ""
  try { clientName = validateAuthorize(p).client_name } catch (e) { error = e instanceof OAuthError ? e.message : "invalid request" }
  const canWrite = !!user && hasPermission(user.role, "can_edit")

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{t("auth.oauth.title")}</h1>
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t("auth.oauth.invalid")}: {error}</p>
        ) : (
          <form method="post" action="/api/oauth/authorize" className="space-y-4">
            <p className="text-sm text-slate-700">{t("auth.oauth.lead", { client: clientName, email: user?.email ?? "" })}</p>
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium text-slate-800">{t("auth.oauth.access")}</legend>
              <label className="flex items-start gap-2"><input type="radio" name="mode" value="read" defaultChecked /> <span>{t("auth.oauth.read")}</span></label>
              <label className={`flex items-start gap-2 ${canWrite ? "" : "opacity-50"}`}><input type="radio" name="mode" value="write" disabled={!canWrite} /> <span>{t("auth.oauth.write")}</span></label>
              {!canWrite && <p className="text-xs text-slate-500">{t("auth.oauth.writeNotAllowed")}</p>}
            </fieldset>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{t("auth.oauth.note")}</p>
            {Object.entries({ client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state, code_challenge: p.codeChallenge, code_challenge_method: p.method, response_type: p.responseType }).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <div className="flex gap-3">
              <button type="submit" name="decision" value="allow" className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{t("auth.oauth.allow")}</button>
              <button type="submit" name="decision" value="deny" className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{t("auth.oauth.deny")}</button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
