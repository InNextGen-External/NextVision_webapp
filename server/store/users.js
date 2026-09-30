import crypto from 'node:crypto'
import { hashPassword } from '../auth.js'

const out = (r) => r && ({ id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at })
export const countUsers = async (db) => (await db.query('select count(*)::int n from users'))[0].n
export const listUsers = async (db) => (await db.query('select * from users order by created_at')).map(out)
export const getUser = async (db, id) => out((await db.query('select * from users where id=$1', [id]))[0])
export const findByUsername = async (db, u) => (await db.query('select * from users where lower(username)=lower($1)', [u]))[0]
export async function createUser(db, { username, displayName, role, password }) {
  const id = crypto.randomUUID()
  await db.query('insert into users(id,username,display_name,role,password_hash) values($1,$2,$3,$4,$5)', [id, username, displayName, role, await hashPassword(password)])
  return getUser(db, id)
}
export const activeAdmins = async (db) => (await db.query(`select id from users where role='admin' and active`)).map((r) => r.id)
