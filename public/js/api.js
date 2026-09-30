export const state = { csrf: '', me: null }

export class ApiError extends Error { constructor(status, data) { super(data?.error || 'เกิดข้อผิดพลาด'); this.status = status; this.data = data || {} } }

export async function api(method, path, body, opts = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (state.csrf) headers['x-csrf-token'] = state.csrf
  let res
  try { res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' }) }
  catch { throw new ApiError(0, { error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' }) }
  if (opts.raw) return res
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && !path.startsWith('/auth/')) { state.me = null; location.hash = '#/login'; location.reload() }
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}
export const get = (p) => api('GET', p)
export const post = (p, b = {}) => api('POST', p, b)
export const patch = (p, b) => api('PATCH', p, b)
export const put = (p, b) => api('PUT', p, b)
export const del = (p) => api('DELETE', p)
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : '' }
