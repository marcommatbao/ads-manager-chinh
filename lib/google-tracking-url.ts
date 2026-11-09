// ============================================================
// Tách link dán vào thành "trang đích" + "tham số theo dõi"
// ------------------------------------------------------------
// Người chạy quảng cáo quen copy nguyên cái link đã gắn UTM:
//   https://www.matbao.net/ten-mien/dang-ky-ten-mien?utm_source=google_ads&utm_medium=cpc&utm_campaign=domain_brand
//
// Google Ads tách hai phần đó ra hai chỗ:
//   • `final_urls`       — địa chỉ trang, KHÔNG kèm tham số theo dõi
//   • `final_url_suffix` — chuỗi tham số, Google tự ghép vào MỌI link của
//                          chiến dịch: quảng cáo, sitelink, mọi tiện ích
//
// VÌ SAO KHÔNG để nguyên tham số trong final_urls: Google vẫn nhận, nhưng khi
// đó chỉ đúng MẨU QUẢNG CÁO có UTM. Sitelink và các tiện ích khác vẫn trỏ tới
// link trần — và đó lại là những chỗ được bấm nhiều. GA4 sẽ thấy một phần lưu
// lượng không gắn nhãn, rồi xếp vào nguồn khác. Dồn vào `final_url_suffix` thì
// mọi đường bấm đều mang cùng một bộ nhãn.
//
// Hàm này để người dùng cứ dán nguyên link quen thuộc, tool tự đặt đúng chỗ.
// ============================================================

export interface SplitTrackingUrl {
  ok: boolean;
  /** Địa chỉ trang, đã bỏ tham số theo dõi. */
  finalUrl: string;
  /** Chuỗi tham số cho `final_url_suffix`, không có dấu `?` đứng đầu. */
  suffix: string;
  /** Tham số đã tách ra, để hiện cho người dùng xem lại. */
  params: Array<{ key: string; value: string }>;
  /** Phần neo `#...` — Google KHÔNG nhận trong final_url_suffix. */
  droppedHash?: string;
  problem?: string;
}

/**
 * Tên tham số được coi là "theo dõi" và chuyển sang suffix.
 *
 * Chỉ chuyển những tham số ĐÚNG LÀ để đo lường. Tham số khác có thể là thứ
 * trang web cần để hiện đúng nội dung (`?goi=premium`, `?tab=bang-gia`) —
 * chuyển nhầm sang suffix thì trang vẫn nhận được, nhưng gộp chung với tham số
 * đo lường làm người đọc sau này không phân biệt được cái nào là gì.
 */
const TRACKING_PREFIXES = ["utm_", "hsa_", "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "yclid"];
const TRACKING_EXACT = new Set(["ref", "source", "campaignid", "adgroupid", "creative", "matchtype", "network", "device", "targetid", "placement", "keyword"]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PREFIXES.some((p) => k.startsWith(p)) || TRACKING_EXACT.has(k);
}

/**
 * Tách một link dán vào.
 *
 * `moveAllParams = true` thì chuyển MỌI tham số sang suffix, không chỉ tham số
 * theo dõi — dùng khi người dùng nói rõ họ muốn thế.
 */
export function splitTrackingUrl(input: string, opts: { moveAllParams?: boolean } = {}): SplitTrackingUrl {
  const raw = (input ?? "").trim();
  const empty: SplitTrackingUrl = { ok: false, finalUrl: "", suffix: "", params: [] };
  if (!raw) return { ...empty, problem: "Chưa nhập đường dẫn." };

  let u: URL;
  try {
    u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return { ...empty, problem: `"${raw}" không phải một địa chỉ web hợp lệ.` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ...empty, problem: "Đường dẫn phải bắt đầu bằng http:// hoặc https://." };
  }

  const moved: Array<{ key: string; value: string }> = [];
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams.entries()) {
    if (opts.moveAllParams || isTrackingParam(k)) moved.push({ key: k, value: v });
    else kept.append(k, v);
  }

  // Google KHÔNG nhận phần neo trong final_url_suffix, và neo cũng không đi
  // qua được phép ghép tham số. Bỏ và NÓI RA thay vì lặng lẽ vứt.
  const droppedHash = u.hash ? u.hash : undefined;

  const base = new URL(u.toString());
  base.hash = "";
  base.search = kept.toString() ? `?${kept.toString()}` : "";

  return {
    ok: true,
    finalUrl: base.toString(),
    // Dựng tay thay vì URLSearchParams.toString(): bộ đó mã hoá dấu ngoặc nhọn
    // thành %7B%7D, mà Google cần {keyword}, {adgroupid}… ở dạng NGUYÊN VĂN
    // thì mới thay được giá trị thật lúc chạy.
    suffix: moved.map(({ key, value }) => `${key}=${value}`).join("&"),
    params: moved,
    droppedHash,
    problem: droppedHash
      ? `Đã bỏ phần neo "${droppedHash}" — Google không nhận dấu # trong tham số theo dõi.`
      : undefined,
  };
}
