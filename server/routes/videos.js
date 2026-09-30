import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { HttpError, bad, forbidden, isUuid, notFound, str } from '../http.js'
import { can, canDeleteVideo, canEditVideo } from '../roles.js'
import { audit } from '../store/misc.js'
import { cleanLines, cleanModules, cleanZones, listEvents, listVideos, loadVideo, toApi } from '../store/videos.js'
import { mediaDir, posterPath, previewExt, previewPath } from '../services/jobs.js'

const EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.3gp'])
const BUSY = new Set(['preparing', 'queued', 'processing'])
const dec = (v) => { try { return decodeURIComponent(String(v || '')) } catch { return String(v || '') } }

export function videoRoutes({ db, config, jobs }) {
  const r = Router()

  r.get('/', async (req, res) => {
    const rows = await listVideos(db, req.user, { all: can(req.user, 'videos.viewAll'), q: str(req.query.q, 80), status: str(req.query.status, 20) })
    res.json({ videos: rows.map(toApi) })
  })

  // Raw binary upload (no multipart): the body is the file, name/customer travel in headers.
  r.post('/upload', async (req, res) => {
    if (!can(req.user, 'videos.use')) throw forbidden()
    const fileName = str(dec(req.get('x-file-name')), 200) || 'clip.mp4'
    const ext = path.extname(fileName).toLowerCase()
    if (!EXT.has(ext)) throw bad('รองรับไฟล์วิดีโอ .mp4 .mov .avi .mkv .webm เท่านั้น')
    const max = config.maxUploadMb * 1024 * 1024, len = Number(req.get('content-length') || 0)
    if (len > max) throw new HttpError(413, `ไฟล์ใหญ่เกิน ${config.maxUploadMb} MB`)
    const id = crypto.randomUUID(), dir = mediaDir(config, id), up = path.join(dir, 'upload' + ext)
    fs.mkdirSync(dir, { recursive: true })
    let n = 0
    const cap = new Transform({ transform(c, _e, cb) { n += c.length; n > max ? cb(new HttpError(413, `ไฟล์ใหญ่เกิน ${config.maxUploadMb} MB`)) : cb(null, c) } })
    try { await pipeline(req, cap, fs.createWriteStream(up)) } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e instanceof HttpError ? e : new HttpError(400, 'อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง') }
    if (!n) { fs.rmSync(dir, { recursive: true, force: true }); throw bad('ไฟล์ว่างเปล่า') }
    const name = str(dec(req.get('x-name')), 120) || fileName.replace(/\.[^.]+$/, '')
    await db.query(`insert into videos(id,name,customer,file_name,size_bytes,owner_user_id,created_by) values($1,$2,$3,$4,$5,$6,$6)`,
      [id, name, str(dec(req.get('x-customer')), 120), fileName, n, req.user.id])
    await audit(db, req.user, 'video.upload', 'video', id, { file: fileName, bytes: n })
    jobs.enqueuePrepare(id, up)
    res.status(201).json({ id })
  })

  r.get('/:id', async (req, res) => res.json({ video: toApi(await loadVideo(db, req.user, req.params.id)) }))

  r.patch('/:id', async (req, res) => {
    const v = await loadVideo(db, req.user, req.params.id)
    if (!canEditVideo(req.user, v)) throw forbidden()
    if (BUSY.has(v.status)) throw new HttpError(409, 'คลิปกำลังประมวลผลอยู่ แก้ไขไม่ได้ในขณะนี้')
    const b = req.body || {}, sets = [], vals = [v.id]
    const set = (col, val, json) => { vals.push(json ? JSON.stringify(val) : val); sets.push(`${col}=$${vals.length}`) }
    if (b.name !== undefined) { const nm = str(b.name, 120); if (!nm) throw bad('ต้องมีชื่อคลิป'); set('name', nm) }
    if (b.customer !== undefined) set('customer', str(b.customer, 120))
    if (b.zones !== undefined) set('zones', cleanZones(b.zones), true)
    if (b.lines !== undefined) set('lines', cleanLines(b.lines), true)
    if (b.modules !== undefined) set('modules', cleanModules(b.modules), true)
    if (!sets.length) throw bad('ไม่มีข้อมูลที่ต้องแก้ไข')
    await db.query(`update videos set ${sets.join(',')} where id=$1`, vals)
    await audit(db, req.user, 'video.update', 'video', v.id, { fields: Object.keys(b) })
    res.json({ video: toApi(await loadVideo(db, req.user, v.id)) })
  })

  r.post('/:id/analyze', async (req, res) => {
    const v = await loadVideo(db, req.user, req.params.id)
    if (!canEditVideo(req.user, v)) throw forbidden()
    if (BUSY.has(v.status)) throw new HttpError(409, 'คลิปนี้อยู่ในคิวหรือกำลังประมวลผลอยู่แล้ว')
    if (!v.prepared) throw bad('คลิปยังไม่พร้อมวิเคราะห์')
    await audit(db, req.user, 'video.analyze', 'video', v.id, { zones: v.zones.length, lines: v.lines.length })
    await jobs.enqueueAnalyze(v.id)
    res.status(202).json({ video: toApi(await loadVideo(db, req.user, v.id)) })
  })

  r.delete('/:id', async (req, res) => {
    const v = await loadVideo(db, req.user, req.params.id)
    if (!canDeleteVideo(req.user, v)) throw forbidden()
    if (BUSY.has(v.status) && v.status !== 'preparing') throw new HttpError(409, 'รอให้ประมวลผลเสร็จก่อนลบ')
    await db.query('delete from videos where id=$1', [v.id])
    fs.rmSync(mediaDir(config, v.id), { recursive: true, force: true })
    await audit(db, req.user, 'video.delete', 'video', v.id, { name: v.name })
    res.json({ ok: true })
  })

  r.get('/:id/poster', async (req, res) => {
    const v = await loadVideo(db, req.user, req.params.id)
    const p = posterPath(config, v.id); if (!fs.existsSync(p)) throw notFound('ยังไม่มีภาพตัวอย่าง')
    res.set('Cache-Control', 'private, max-age=3600'); res.type('jpg').sendFile(p)
  })
  r.get('/:id/file', async (req, res) => {
    const v = await loadVideo(db, req.user, req.params.id)
    const p = previewPath(config, v.id); if (!fs.existsSync(p)) throw notFound('ไม่พบไฟล์วิดีโอ')
    res.set('Cache-Control', 'private, max-age=3600'); res.type(previewExt(config) === 'webm' ? 'video/webm' : 'video/mp4').sendFile(p)
  })
  r.get('/:id/result', async (req, res) => {
    const v = await loadVideo(db, req.user, req.params.id)
    const row = (await db.query('select data from video_results where video_id=$1', [v.id]))[0]
    if (!row) throw notFound('ยังไม่มีผลวิเคราะห์')
    const events = (await listEvents(db, v.id)).map((e) => ({ i: e.idx, t: e.t, type: e.type, sev: e.sev, label: e.label, trackId: e.track_id, group: e.group_name, zone: e.zone_id, line: e.line_id, dir: e.dir, frame: e.has_frame }))
    res.json({ video: toApi(v), result: row.data, events })
  })
  r.get('/:id/events/:idx/frame', async (req, res) => {
    const v = await loadVideo(db, req.user, req.params.id)
    const row = (await db.query('select frame from video_events where video_id=$1 and idx=$2', [v.id, Number(req.params.idx) | 0]))[0]
    if (!row?.frame) throw notFound('ไม่มีภาพเหตุการณ์นี้')
    res.set('Cache-Control', 'private, max-age=86400').type('jpg').send(Buffer.from(row.frame))
  })
  return r
}
