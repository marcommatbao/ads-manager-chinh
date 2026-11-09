// ============================================================
// Gọi Graph API cho "Xử lý chiến dịch" (Facebook) — đọc, kiểm, ghi
// ============================================================
// Đi qua graphFetch để tôn trọng thời gian nghỉ khi Meta báo hết hạn mức: app
// đang ở bậc development (~60 lượt/giờ/tài khoản), mỗi phiên phải tiết kiệm.
// Lỗi luôn được xoá token trước khi ném ra — thông báo lỗi đi thẳng lên UI.

import { graphFetch, throwIfMetaError } from "@/lib/meta-client"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"

const BASE = META_GRAPH_BASE

function token(): string {
  const t = process.env.META_ACCESS_TOKEN
  if (!t) throw new Error("META_ACCESS_TOKEN chưa cấu hình")
  return t
}

export function adAccountId(): string {
  const id = process.env.META_AD_ACCOUNT_ID
  if (!id) throw new Error("META_AD_ACCOUNT_ID chưa cấu hình")
  return id.replace(/^act_/, "")
}

function scrub(e: unknown): Error {
  const t = process.env.META_ACCESS_TOKEN
  const msg = e instanceof Error ? e.message : String(e)
  return new Error(t ? msg.split(t).join("***") : msg)
}

/** Lỗi nhất thời của Meta (đo 27/09: "Service temporarily unavailable" giữa một lượt đọc bình thường). */
export const isTransientMetaError = (msg: string) => /temporarily unavailable|unexpected error has occurred|please retry|fetch failed/i.test(msg)

/** Đọc — thử lại ĐÚNG MỘT lần khi Meta lỗi nhất thời. Không áp cho lệnh ghi (metaPost). */
export async function metaGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  try {
    return await metaGetOnce<T>(path, params)
  } catch (e) {
    if (!(e instanceof Error) || !isTransientMetaError(e.message)) throw e
    await new Promise((r) => setTimeout(r, 1500))
    return metaGetOnce<T>(path, params)
  }
}

async function metaGetOnce<T>(path: string, params: Record<string, string>): Promise<T> {
  const u = new URL(`${BASE}/${path.replace(/^\//, "")}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.searchParams.set("access_token", token())
  try {
    const res = await graphFetch(u.toString(), { signal: AbortSignal.timeout(30_000) })
    const j = (await res.json()) as T & { error?: { message?: string; code?: number } }
    throwIfMetaError(j)
    if (!res.ok) throw new Error(`Meta API ${res.status}`)
    return j
  } catch (e) {
    throw scrub(e)
  }
}

/** Lấy hết các trang của một edge (dừng khi trang rỗng hoặc chạm trần). */
export async function metaGetAll<T>(path: string, params: Record<string, string>, maxPages = 10): Promise<T[]> {
  const first = await metaGet<{ data?: T[]; paging?: { next?: string } }>(path, params)
  const out = [...(first.data ?? [])]
  let next = first.paging?.next
  for (let p = 1; next && p < maxPages; p++) {
    try {
      const once = async () => {
        const res = await graphFetch(next!, { signal: AbortSignal.timeout(30_000) })
        const j = (await res.json()) as { data?: T[]; paging?: { next?: string }; error?: { message?: string; code?: number } }
        throwIfMetaError(j)
        return j
      }
      let j: Awaited<ReturnType<typeof once>>
      try { j = await once() } catch (e) {
        if (!(e instanceof Error) || !isTransientMetaError(e.message)) throw e
        await new Promise((r) => setTimeout(r, 1500)); j = await once()
      }
      if (!j.data?.length) break
      out.push(...j.data)
      next = j.paging?.next
    } catch (e) {
      throw scrub(e)
    }
  }
  return out
}

/**
 * POST lên một đối tượng. `validateOnly` = Meta chỉ kiểm DỮ LIỆU, không ghi.
 * Đo 21/09: chế độ này KHÔNG kiểm quyền ghi — qua được vẫn có thể hỏng lúc ghi thật.
 */
export async function metaPost(id: string, body: Record<string, unknown>, validateOnly: boolean): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...body, access_token: token() }
  if (validateOnly) payload.execution_options = ["validate_only"]
  try {
    const res = await graphFetch(`${BASE}/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number; error_user_msg?: string } }
    if (j.error?.error_user_msg) j.error.message = `${j.error.message ?? ""} — ${j.error.error_user_msg}`
    throwIfMetaError(j)
    if (!res.ok) throw new Error(`Meta API ${res.status}`)
    return j
  } catch (e) {
    throw scrub(e)
  }
}
