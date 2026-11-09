// ============================================================
// fetch JSON dùng chung cho các trang "Xử lý chiến dịch"
// ------------------------------------------------------------
// Mọi route /api/cases/** trả {success:false, error} kèm status lỗi
// (xem lib/case/http.ts fail()) — không có trường hợp success:false mà
// status 200. Riêng /execute trả success:true khi đã xử lý yêu cầu — kết quả
// ghi thật (done/failed) đọc ở execution.status, không ở success.
// ============================================================

export class ApiError extends Error {}

async function parse(res: Response): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new ApiError(data?.error ?? `Lỗi không xác định (${res.status})`);
  }
  return data;
}

export const getJson = (url: string) => fetch(url).then(parse);

export function postJson(url: string, body?: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(parse);
}

export function patchJson(url: string, body?: unknown) {
  return fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(parse);
}

export function putJson(url: string, body?: unknown) {
  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(parse);
}

export const deleteJson = (url: string) => fetch(url, { method: "DELETE" }).then(parse);
