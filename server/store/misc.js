export async function audit(db, user, action, entity, entityId, detail = null) {
  await db.query('insert into audit_log(user_id,username,action,entity,entity_id,detail) values($1,$2,$3,$4,$5,$6)',
    [user?.id || null, user?.username || 'system', action, entity, entityId ? String(entityId) : null, detail ? JSON.stringify(detail) : null])
}
export const listAudit = (db, { limit = 200, entity, entityId } = {}) => db.query(
  `select id, at, username, action, entity, entity_id, detail from audit_log
   where ($2::text is null or entity=$2) and ($3::text is null or entity_id=$3) order by id desc limit $1`, [Math.min(limit, 1000), entity || null, entityId || null])

export const DEFAULT_SETTINGS = {
  companyName: 'InNextGen',
  sampleFps: 5,            // frames analysed per second of video (higher = finer tracking, slower)
  minConfidence: 0.3,      // detector threshold
  crowdThreshold: 8,       // people in one frame that count as "crowded"; 0 = off
  keepClipDays: 0,         // reserved: 0 = keep until deleted
}
export async function getSettings(db) {
  const rows = await db.query('select key, value from settings')
  const out = { ...DEFAULT_SETTINGS }
  for (const r of rows) out[r.key] = r.value
  return out
}
export async function setSettings(db, patch) {
  for (const [k, v] of Object.entries(patch)) {
    await db.query('insert into settings(key,value) values($1,$2) on conflict (key) do update set value=excluded.value', [k, JSON.stringify(v)])
  }
}
