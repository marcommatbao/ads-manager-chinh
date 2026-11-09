// ============================================================
// Đọc cấu hình GTM CÔNG KHAI (gtm.js) — không cần quyền, CHỈ ĐỌC
// ============================================================
// Đo 27/09: GTM-T7JTFFP (matbao.in) có thẻ Facebook Pixel đặt "Custom" với
// tên kiểu GA4 (add_to_cart, add_payment_info) → Meta coi là sự kiện tự đặt,
// nhóm tối ưu theo sự kiện chuẩn không thấy. User sửa → bản 129 đúng hết.
// gtm.js là tệp trình duyệt tải về nên ai cũng đọc được; đọc nó là cách duy nhất
// biết CHÍNH XÁC thẻ nào gửi tên nào mà không cần quyền vào GTM.
//
// Định dạng gtm.js không được Google công bố → đọc phòng thủ: không nhận ra thì
// trả rỗng + ghi chú, KHÔNG đoán.

export interface GtmPixelTag {
  tagId: string
  pixelId: string | null
  /** standard = Meta hiểu nghĩa sự kiện; custom = sự kiện tự đặt. */
  kind: "standard" | "custom"
  eventName: string
  hasEventId: boolean
  /** "template" = thẻ mẫu Facebook Pixel; "html" = thẻ HTML tự viết gọi fbq(). */
  source: "template" | "html"
  /** Tên sự kiện lấy từ BIẾN GTM (vd fbq("track", {{Event}})) — không đọc tĩnh được; không chấm lỗi theo tên. */
  dynamic?: boolean
}

export interface GtmContainer {
  id: string
  version: string | null
  pixelTags: GtmPixelTag[]
  /** Nhãn chuyển đổi Google Ads có thẻ trong container: "AW-<id>/<label>". */
  googleAdsLabels: { tagId: string; sendTo: string }[]
  /** "api" = đọc qua Tag Manager API (có trigger); không có = gtm.js công khai. */
  source?: "api" | "public"
  versionName?: string
  /** Chỉ có khi đọc qua API: thẻ Meta/Google kèm trigger bắn. */
  tagsDetail?: {
    tagId: string; name: string; type: "meta" | "google"; paused: boolean
    eventName: string | null; sendTo: string | null
    triggers: GtmTriggerInfo[]
  }[]
  triggers?: GtmTriggerInfo[]
}
export interface GtmTriggerInfo { id: string; name: string; condition: string; customEvent: string | null }

/** Tách từng khối thẻ: lùi từ mỗi `"tag_id":N}` về `{"function":` gần nhất. */
function tagBlocks(js: string): { fn: string; tagId: string; body: string }[] {
  const out: { fn: string; tagId: string; body: string }[] = []
  const re = /"tag_id":(\d+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(js))) {
    const start = js.lastIndexOf('{"function":"', m.index)
    if (start < 0) continue
    const body = js.slice(start, m.index + m[0].length)
    const fn = /^\{"function":"([^"]+)"/.exec(body)?.[1] ?? ""
    out.push({ fn, tagId: m[1], body })
  }
  return out
}

const field = (body: string, key: string): string | null => {
  const m = new RegExp(`"${key}":"([^"]*)"`).exec(body)
  return m ? m[1] : null
}

export function parseGtm(id: string, js: string): GtmContainer {
  const pixelTags: GtmPixelTag[] = []
  const googleAdsLabels: GtmContainer["googleAdsLabels"] = []
  for (const t of tagBlocks(js)) {
    if (t.body.includes('"vtp_pixelId"') && t.body.includes('"vtp_eventName"')) {
      const kind = field(t.body, "vtp_eventName") === "standard" ? "standard" : "custom"
      const name = kind === "standard" ? field(t.body, "vtp_standardEventName") : field(t.body, "vtp_customEventName")
      if (name) {
        pixelTags.push({ tagId: t.tagId, pixelId: field(t.body, "vtp_pixelId"), kind, eventName: name,
          hasEventId: /"vtp_eventId":(\["macro"|")/.test(t.body), source: "template" })
      }
    } else if (t.fn === "__html") {
      // Thẻ HTML tự viết: fbq('track'|'trackCustom', 'Tên'). Chuỗi trong gtm.js bị thoát \x27 / \" nên chuẩn hoá trước.
      const html = t.body.replace(/\\x27/g, "'").replace(/\\"/g, '"')
      // Đo 27/09 MBC thẻ 257: fbq("track", <biến>) — tên nằm trong biến, sau dấu phẩy là ["escape",["macro",40]…
      for (const f of html.matchAll(/fbq\(\s*['"](track|trackCustom|trackSingle|trackSingleCustom)['"]\s*,\s*(?:['"](\d+)['"]\s*,\s*)?(['"]([A-Za-z][A-Za-z0-9_]*)['"]|["']?,?\[)/g)) {
        const named = !!f[4]
        pixelTags.push({ tagId: t.tagId, pixelId: f[2] ?? null, kind: /Custom/.test(f[1]) ? "custom" : "standard",
          eventName: named ? f[4] : "(tên lấy từ biến GTM)", hasEventId: /eventID/.test(html), source: "html", dynamic: !named })
      }
    } else if (t.fn === "__awct") {
      const cid = field(t.body, "vtp_conversionId"), label = field(t.body, "vtp_conversionLabel")
      if (cid && label) googleAdsLabels.push({ tagId: t.tagId, sendTo: `AW-${cid}/${label}` })
    }
  }
  return { id, version: /"version":"(\d+)"/.exec(js)?.[1] ?? null, pixelTags, googleAdsLabels }
}

/** Mã GTM nhúng trên trang (vd lấy từ trang đích của bảng link chuẩn). */
/** Đo 27/09: một lượt "fetch failed" nhất thời làm mất cả phần GTM — thử lại 1 lần. */
async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init) } catch { await new Promise((r) => setTimeout(r, 1000)); return fetch(url, init) }
}

export async function detectGtmIds(pageUrls: string[]): Promise<string[]> {
  const ids = new Set<string>()
  for (const u of pageUrls.slice(0, 3)) {
    try {
      const html = await (await fetchRetry(u, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Mozilla/5.0 AdsCommand" } })).text()
      for (const m of html.matchAll(/GTM-[A-Z0-9]{4,10}/g)) ids.add(m[0])
    } catch { /* trang lỗi → thử trang khác */ }
  }
  return [...ids]
}

export async function fetchGtm(id: string): Promise<GtmContainer> {
  if (!/^GTM-[A-Z0-9]{4,10}$/.test(id)) throw new Error("Mã GTM không hợp lệ")
  const res = await fetchRetry(`https://www.googletagmanager.com/gtm.js?id=${id}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" })
  if (!res.ok) throw new Error(`Không tải được gtm.js của ${id} (${res.status})`)
  return parseGtm(id, await res.text())
}
