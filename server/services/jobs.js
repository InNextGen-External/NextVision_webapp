import fs from 'node:fs'
import path from 'node:path'
import { getSettings } from '../store/misc.js'
import { replaceResults } from '../store/videos.js'

export const mediaDir = (config, id) => path.join(config.dataDir, 'media', id)
export const previewExt = (config) => (config.previewCodec === 'vp9' ? 'webm' : 'mp4')
export const previewPath = (config, id) => path.join(mediaDir(config, id), `preview.${previewExt(config)}`)
export const posterPath = (config, id) => path.join(mediaDir(config, id), 'poster.jpg')

/** One job at a time: video decoding is CPU-heavy and the host is usually small. */
export function createJobs({ db, config, worker }) {
  let tail = Promise.resolve()
  const queue = (fn) => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run }
  const setVideo = (id, patch) => {
    const keys = Object.keys(patch)
    return db.query(`update videos set ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} where id=$1`, [id, ...keys.map((k) => (patch[k] !== null && typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]))])
  }

  async function prepareJob(id, upload) {
    await setVideo(id, { status: 'preparing', error: '' })
    try {
      const meta = await worker.prepare({ input: upload, output: previewPath(config, id), poster: posterPath(config, id), codec: config.previewCodec, maxSeconds: config.maxClipSeconds })
      await setVideo(id, { status: 'ready', prepared: true, width: meta.width, height: meta.height, fps: meta.fps, duration: meta.duration })
    } catch (e) {
      console.error('[prepare]', id, e.message)
      await setVideo(id, { status: 'failed', error: e.message })
      fs.rmSync(mediaDir(config, id), { recursive: true, force: true })
    } finally { fs.rmSync(upload, { force: true }) }
  }

  async function analyzeJob(id) {
    const row = (await db.query('select * from videos where id=$1 and deleted_at is null', [id]))[0]
    if (!row) return
    await setVideo(id, { status: 'processing', progress: 0, error: '' })
    const dir = mediaDir(config, id), out = path.join(dir, 'out'), cfgPath = path.join(dir, 'cfg.json')
    try {
      const s = await getSettings(db)
      fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(cfgPath, JSON.stringify({ sampleFps: s.sampleFps, minConfidence: s.minConfidence, crowdThreshold: s.crowdThreshold, modules: row.modules, zones: row.zones, lines: row.lines }))
      let lastWrite = 0
      const done = await worker.analyze({ video: previewPath(config, id), configPath: cfgPath, outDir: out, onProgress: (p) => { if (Date.now() - lastWrite > 1500) { lastWrite = Date.now(); setVideo(id, { progress: p.progress || 0 }).catch(() => {}) } } })
      const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
      await db.tx(async (t) => {
        await replaceResults(t, id, result, async (i) => { try { return fs.readFileSync(path.join(out, 'frames', `ev_${i}.jpg`)) } catch { return null } })
        await t.query(`update videos set status='done', progress=1, summary=$2, meta=$3, finished_at=now(), error='' where id=$1`, [id, JSON.stringify(done.summary || result.summary), JSON.stringify(done.meta || result.meta)])
      })
    } catch (e) {
      console.error('[analyze]', id, e.message)
      await setVideo(id, { status: 'failed', error: e.message })
    } finally { fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(cfgPath, { force: true }) }
  }

  return {
    enqueuePrepare: (id, upload) => { queue(() => prepareJob(id, upload)).catch(() => {}) },
    enqueueAnalyze: async (id) => { await setVideo(id, { status: 'queued', progress: 0, error: '' }); queue(() => analyzeJob(id)).catch(() => {}) },
    idle: () => tail,
    /** After a restart nothing is running: put interrupted clips back into a usable state. */
    async recover() {
      // Hosts without a persistent disk lose media files on redeploy: don't pretend those clips still exist.
      for (const r of await db.query(`select id from videos where prepared and deleted_at is null`)) {
        if (!fs.existsSync(previewPath(config, r.id))) await setVideo(r.id, { status: 'failed', prepared: false, error: 'ไฟล์คลิปหายไป (พื้นที่เก็บไฟล์ของเซิร์ฟเวอร์ไม่ถาวร) กรุณาอัปโหลดใหม่' })
      }
      await db.query(`update videos set status='ready', error='ระบบรีสตาร์ทระหว่างประมวลผล กดวิเคราะห์ใหม่อีกครั้ง' where status in ('queued','processing') and prepared`)
      await db.query(`update videos set status='failed', error='ระบบรีสตาร์ทระหว่างเตรียมคลิป กรุณาอัปโหลดใหม่' where status='preparing'`)
    },
  }
}
