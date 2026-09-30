import { Router } from 'express'
import { bad, forbidden, isUuid, notFound, str } from '../http.js'
import { checkPasswordPolicy, hashPassword } from '../auth.js'
import { ROLES, can } from '../roles.js'
import { audit } from '../store/misc.js'
import { activeAdmins, createUser, findByUsername, getUser, listUsers } from '../store/users.js'

export function userRoutes({ db, config }) {
  const r = Router()
  r.use((req, _res, next) => (can(req.user, 'users.manage') ? next() : next(forbidden())))

  r.get('/', async (_req, res) => res.json({ users: await listUsers(db) }))

  r.post('/', async (req, res) => {
    const username = str(req.body?.username, 60), displayName = str(req.body?.displayName, 80) || username, role = req.body?.role
    if (!/^[\p{L}\p{N}._-]{3,60}$/u.test(username)) throw bad('ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษร ตัวเลข . _ - อย่างน้อย 3 ตัว')
    if (!ROLES.includes(role)) throw bad('role ไม่ถูกต้อง')
    checkPasswordPolicy(req.body?.password, config.passwordMinLength)
    if (await findByUsername(db, username)) throw bad('ชื่อผู้ใช้นี้ถูกใช้แล้ว')
    const u = await createUser(db, { username, displayName, role, password: req.body.password })
    await audit(db, req.user, 'user.create', 'user', u.id, { username, role })
    res.status(201).json({ user: u })
  })

  r.patch('/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound()
    const u = await getUser(db, req.params.id); if (!u) throw notFound()
    const next = { displayName: req.body?.displayName != null ? str(req.body.displayName, 80) : u.displayName, role: req.body?.role ?? u.role, active: req.body?.active ?? u.active }
    if (!ROLES.includes(next.role)) throw bad('role ไม่ถูกต้อง')
    if (!next.displayName) throw bad('ต้องมีชื่อที่แสดง')
    const losesAdmin = u.role === 'admin' && u.active && (next.role !== 'admin' || !next.active)
    if (losesAdmin) {
      if (u.id === req.user.id) throw bad('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้')
      if ((await activeAdmins(db)).filter((id) => id !== u.id).length === 0) throw bad('ต้องเหลือ Admin ที่ใช้งานอยู่อย่างน้อย 1 คน')
    }
    await db.query('update users set display_name=$2, role=$3, active=$4 where id=$1', [u.id, next.displayName, next.role, Boolean(next.active)])
    if (!next.active) await db.query('delete from sessions where user_id=$1', [u.id])
    await audit(db, req.user, 'user.update', 'user', u.id, { before: { role: u.role, active: u.active, displayName: u.displayName }, after: next })
    res.json({ user: await getUser(db, u.id) })
  })

  r.post('/:id/reset-password', async (req, res) => {
    if (!isUuid(req.params.id) || !(await getUser(db, req.params.id))) throw notFound()
    checkPasswordPolicy(req.body?.password, config.passwordMinLength)
    await db.query('update users set password_hash=$2 where id=$1', [req.params.id, await hashPassword(req.body.password)])
    await db.query('delete from sessions where user_id=$1', [req.params.id])
    await audit(db, req.user, 'user.reset_password', 'user', req.params.id)
    res.json({ ok: true })
  })

  return r
}
