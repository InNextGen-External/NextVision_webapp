import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from './http.js'

const scrypt = promisify(crypto.scrypt)
const N = 16384, R = 8, P = 1, KEYLEN = 32

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}
export async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored || '').split('$')
  if (alg !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return crypto.timingSafeEqual(key, expected)
}
// Constant-ish work for unknown users so login timing does not reveal which usernames exist.
export const DUMMY_HASH = await hashPassword('dummy-password-for-timing')

export function checkPasswordPolicy(password, min) {
  const pw = String(password || '')
  if (pw.length < min) throw new HttpError(400, `รหัสผ่านต้องยาวอย่างน้อย ${min} ตัวอักษร`)
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข')
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const COOKIE = 'nextvision_sid'

export function createAuth({ db, config }) {
  const fails = new Map() // key -> { n, until }
  const key = (u, ip) => `${String(u).toLowerCase()}|${ip}`

  const lock = {
    check(u, ip) {
      const f = fails.get(key(u, ip))
      if (f?.until && f.until > Date.now()) throw new HttpError(429, `ลองผิดหลายครั้ง กรุณารอ ${Math.ceil((f.until - Date.now()) / 60000)} นาที`)
    },
    fail(u, ip) {
      const k = key(u, ip); const f = fails.get(k) || { n: 0 }
      f.n += 1
      if (f.n >= config.lockoutAttempts) { f.until = Date.now() + config.lockoutMinutes * 60_000; f.n = 0 }
      fails.set(k, f)
    },
    clear(u, ip) { fails.delete(key(u, ip)) },
  }

  const cookieOpts = (req, maxAgeMs) => ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(maxAgeMs / 1000)}`, ...(config.cookieSecure || req.secure ? ['Secure'] : [])].join('; ')

  async function startSession(req, res, userId) {
    const token = crypto.randomBytes(32).toString('hex')
    const csrf = crypto.randomBytes(24).toString('hex')
    const ms = config.sessionHours * 3_600_000
    await db.query('insert into sessions(id,user_id,csrf,expires_at) values($1,$2,$3,$4)', [sha(token), userId, csrf, new Date(Date.now() + ms)])
    res.append('Set-Cookie', `${COOKIE}=${token}; ${cookieOpts(req, ms)}`)
    return csrf
  }
  async function endSession(req, res) {
    const token = parseCookie(req)
    if (token) await db.query('delete from sessions where id=$1', [sha(token)])
    res.append('Set-Cookie', `${COOKIE}=; ${cookieOpts(req, 0)}`)
  }
  const parseCookie = (req) => (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || ''

  /** Attaches req.user / req.session when a valid session cookie is present. */
  async function loadSession(req, _res, next) {
    const token = parseCookie(req)
    if (token) {
      const rows = await db.query(
        `select s.id sid, s.csrf, u.id, u.username, u.display_name, u.role, u.active from sessions s join users u on u.id=s.user_id where s.id=$1 and s.expires_at>now()`, [sha(token)])
      const r = rows[0]
      if (r && r.active) { req.user = { id: r.id, username: r.username, displayName: r.display_name, role: r.role }; req.session = { id: r.sid, csrf: r.csrf } }
    }
    next()
  }
  const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'กรุณาเข้าสู่ระบบ')))
  /** State-changing requests must carry the CSRF token issued with the session. */
  const requireCsrf = (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const t = String(req.get('x-csrf-token') || '')
    const ok = req.session && t.length === req.session.csrf.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(req.session.csrf))
    return ok ? next() : next(new HttpError(403, 'โทเค็นไม่ถูกต้อง กรุณารีเฟรชหน้า'))
  }
  return { lock, startSession, endSession, loadSession, requireAuth, requireCsrf }
}
