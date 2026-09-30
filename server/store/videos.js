import { canSeeVideo } from '../roles.js'
import { HttpError, bad, isUuid, notFound, str } from '../http.js'

export const toApi = (r) => r && ({
  id: r.id, name: r.name, customer: r.customer, fileName: r.file_name, sizeBytes: Number(r.size_bytes), status: r.status, progress: Number(r.progress),
  error: r.error, prepared: r.prepared, width: r.width, height: r.height, fps: r.fps, duration: r.duration,
  zones: r.zones, lines: r.lines, modules: r.modules, summary: r.summary, meta: r.meta,
  ownerUserId: r.owner_user_id, ownerName: r.owner_name || null, createdAt: r.created_at, finishedAt: r.finished_at,
})

const COLS = `v.*, u.display_name owner_name`
export const listVideos = (db, user, { all, q, status } = {}) => db.query(
  `select ${COLS} from videos v left join users u on u.id=v.owner_user_id
   where v.deleted_at is null and ($1::boolean or v.owner_user_id=$2 or v.created_by=$2)
     and ($3::text is null or lower(v.name||' '||v.customer||' '||v.file_name) like '%'||lower($3)||'%') and ($4::text is null or v.status=$4)
   order by v.created_at desc limit 500`, [all, user.id, q || null, status || null])

export async function loadVideo(db, user, id) {
  if (!isUuid(id)) throw notFound('ไม่พบคลิปนี้')
  const r = (await db.query(`select ${COLS} from videos v left join users u on u.id=v.owner_user_id where v.id=$1 and v.deleted_at is null`, [id]))[0]
  if (!r || !canSeeVideo(user, r)) throw notFound('ไม่พบคลิปนี้')
  return r
}

const clamp01 = (n) => Math.min(1, Math.max(0, Math.round(Number(n) * 10000) / 10000))
const pt = (p) => { if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => Number.isFinite(Number(x)))) throw bad('พิกัดไม่ถูกต้อง'); return [clamp01(p[0]), clamp01(p[1])] }
const cls = (v) => (v === 'vehicle' ? 'vehicle' : 'person')
const rid = (v, i, pre) => (/^[a-z0-9_-]{1,24}$/i.test(String(v || '')) ? String(v) : `${pre}${i + 1}`)

export function cleanZones(zs) {
  if (!Array.isArray(zs)) throw bad('รูปแบบโซนไม่ถูกต้อง')
  if (zs.length > 8) throw bad('กำหนดโซนได้สูงสุด 8 โซน')
  return zs.map((z, i) => {
    const points = (Array.isArray(z?.points) ? z.points : []).map(pt)
    if (points.length < 3 || points.length > 24) throw bad('โซนต้องมี 3–24 จุด')
    return { id: rid(z.id, i, 'z'), name: str(z.name, 60) || `โซน ${i + 1}`, kind: z.kind === 'monitor' ? 'monitor' : 'restricted', cls: cls(z.cls), dwellSec: Math.min(3600, Math.max(0, Math.round(Number(z.dwellSec) || 0))), points }
  })
}
export function cleanLines(ls) {
  if (!Array.isArray(ls)) throw bad('รูปแบบเส้นไม่ถูกต้อง')
  if (ls.length > 8) throw bad('กำหนดเส้นได้สูงสุด 8 เส้น')
  return ls.map((l, i) => {
    const points = (Array.isArray(l?.points) ? l.points : []).map(pt)
    if (points.length !== 2) throw bad('เส้นต้องมี 2 จุด')
    return { id: rid(l.id, i, 'l'), name: str(l.name, 60) || `เส้น ${i + 1}`, cls: cls(l.cls), aLabel: str(l.aLabel, 20) || 'A', bLabel: str(l.bLabel, 20) || 'B', points }
  })
}
export function cleanModules(m) {
  const out = { count: true, zone: true, line: true, crowd: true }
  if (m && typeof m === 'object') for (const k of Object.keys(out)) if (typeof m[k] === 'boolean') out[k] = m[k]
  return out
}

export async function replaceResults(t, videoId, result, readFrame) {
  await t.query('delete from video_events where video_id=$1', [videoId])
  await t.query('delete from video_results where video_id=$1', [videoId])
  for (const e of result.events || []) {
    await t.query(`insert into video_events(video_id,idx,t,type,sev,label,track_id,group_name,zone_id,line_id,dir,frame) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [videoId, e.i, e.t, e.type, e.sev, e.label, e.trackId ?? null, e.group || null, e.zone || null, e.line || null, e.dir || null, e.frame ? await readFrame(e.i) : null])
  }
  const { events, ...rest } = result
  await t.query('insert into video_results(video_id,data) values($1,$2)', [videoId, JSON.stringify(rest)])
}
export const listEvents = (db, videoId, { types } = {}) => db.query(
  `select idx, t, type, sev, label, track_id, group_name, zone_id, line_id, dir, (frame is not null) has_frame from video_events where video_id=$1 and ($2::text[] is null or type=any($2)) order by t, idx`, [videoId, types || null])
