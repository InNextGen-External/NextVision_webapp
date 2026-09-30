import { Router } from 'express'
import { bad, forbidden, str } from '../http.js'
import { can } from '../roles.js'
import { audit, getSettings, listAudit, setSettings } from '../store/misc.js'

const num = (v, lo, hi, name) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${name} ต้องอยู่ระหว่าง ${lo}–${hi}`); return n }

export function settingsRoutes({ db }) {
  const r = Router()
  r.use((req, _res, next) => (can(req.user, 'settings.manage') ? next() : next(forbidden())))
  r.get('/', async (_req, res) => res.json({ settings: await getSettings(db) }))
  r.put('/', async (req, res) => {
    const b = req.body || {}, patch = {}
    if (b.companyName !== undefined) { patch.companyName = str(b.companyName, 100); if (!patch.companyName) throw bad('ต้องมีชื่อองค์กร') }
    if (b.sampleFps !== undefined) patch.sampleFps = num(b.sampleFps, 1, 10, 'จำนวนเฟรมที่วิเคราะห์ต่อวินาที')
    if (b.minConfidence !== undefined) patch.minConfidence = num(b.minConfidence, 0.15, 0.9, 'ค่าความมั่นใจต่ำสุด')
    if (b.crowdThreshold !== undefined) patch.crowdThreshold = Math.round(num(b.crowdThreshold, 0, 200, 'เกณฑ์คนหนาแน่น'))
    if (!Object.keys(patch).length) throw bad('ไม่มีข้อมูลที่ต้องแก้ไข')
    await setSettings(db, patch); await audit(db, req.user, 'settings.update', 'settings', null, patch)
    res.json({ settings: await getSettings(db) })
  })
  r.get('/audit', async (req, res) => { if (!can(req.user, 'audit.view')) throw forbidden(); res.json({ audit: await listAudit(db, { limit: Number(req.query.limit) || 200 }) }) })
  return r
}
