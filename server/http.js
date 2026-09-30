export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra) }
}
export const bad = (m, x) => new HttpError(400, m, x)
export const forbidden = (m = 'ไม่มีสิทธิ์ทำรายการนี้') => new HttpError(403, m)
export const notFound = (m = 'ไม่พบข้อมูล') => new HttpError(404, m)
export const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''))
export const str = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
export const isIsoDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false
  const [y, m, d] = String(v).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
