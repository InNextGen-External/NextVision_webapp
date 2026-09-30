import { Router } from 'express'
import { HttpError, bad, str } from '../http.js'
import { DUMMY_HASH, checkPasswordPolicy, hashPassword, verifyPassword } from '../auth.js'
import { permissionsFor } from '../roles.js'
import { audit, getSettings } from '../store/misc.js'
import { countUsers, createUser, findByUsername } from '../store/users.js'

export function authRoutes({ db, config, auth }) {
  const r = Router()

  async function me(req) {
    const s = await getSettings(db)
    return {
      user: req.user, csrf: req.session.csrf, permissions: permissionsFor(req.user),
      workspace: { companyName: s.companyName, maxUploadMb: config.maxUploadMb, maxClipSeconds: config.maxClipSeconds },
    }
  }

  r.get('/state', async (_req, res) => res.json({ needsSetup: (await countUsers(db)) === 0, companyName: (await getSettings(db)).companyName }))

  r.post('/setup', async (req, res) => {
    if ((await countUsers(db)) > 0) throw new HttpError(409, 'ตั้งค่าระบบไปแล้ว')
    const username = str(req.body?.username, 60), displayName = str(req.body?.displayName, 80) || username
    if (!/^[\p{L}\p{N}._-]{3,60}$/u.test(username)) throw bad('ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษร ตัวเลข . _ - อย่างน้อย 3 ตัว')
    checkPasswordPolicy(req.body?.password, config.passwordMinLength)
    const user = await createUser(db, { username, displayName, role: 'admin', password: req.body.password })
    await audit(db, user, 'setup.admin_created', 'user', user.id)
    await auth.startSession(req, res, user.id)
    req.user = user
    res.status(201).json({ ok: true })
  })

  r.post('/login', async (req, res) => {
    const username = str(req.body?.username, 60), password = String(req.body?.password || '')
    auth.lock.check(username, req.ip)
    const row = await findByUsername(db, username)
    const ok = await verifyPassword(password, row?.password_hash || DUMMY_HASH)
    if (!row || !ok || !row.active) {
      auth.lock.fail(username, req.ip)
      await audit(db, { username }, 'auth.login_failed', 'user', row?.id, { ip: req.ip })
      throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    }
    auth.lock.clear(username, req.ip)
    await db.query('update users set last_login_at=now() where id=$1', [row.id])
    const csrf = await auth.startSession(req, res, row.id)
    await audit(db, { id: row.id, username: row.username }, 'auth.login', 'user', row.id)
    res.json({ ok: true, csrf })
  })

  r.post('/logout', async (req, res) => { await auth.endSession(req, res); res.json({ ok: true }) })
  r.get('/me', auth.requireAuth, async (req, res) => res.json(await me(req)))

  r.post('/change-password', auth.requireAuth, auth.requireCsrf, async (req, res) => {
    const [row] = await db.query('select * from users where id=$1', [req.user.id])
    if (!(await verifyPassword(String(req.body?.current || ''), row.password_hash))) throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง')
    checkPasswordPolicy(req.body?.next, config.passwordMinLength)
    await db.query('update users set password_hash=$2 where id=$1', [req.user.id, await hashPassword(req.body.next)])
    await db.query('delete from sessions where user_id=$1 and id<>$2', [req.user.id, req.session.id]) // sign out other devices
    await audit(db, req.user, 'auth.password_changed', 'user', req.user.id)
    res.json({ ok: true })
  })
  return r
}
