import http from 'node:http'
import { openDb } from '../server/db.js'
import { loadConfig } from '../server/config.js'
import { createApp } from '../server/app.js'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

/** Fake worker: no Python, no GPU. Writes the same files the real one does. */
export const fakeWorker = (over = {}) => ({
  async prepare({ output, poster, maxSeconds }) {
    if (over.prepareError) throw new Error(over.prepareError)
    fs.writeFileSync(output, Buffer.from('fake-video')); fs.writeFileSync(poster, JPG)
    return { width: 1280, height: 720, fps: 25, duration: Math.min(30, maxSeconds) }
  },
  async analyze({ outDir, configPath, onProgress }) {
    if (over.analyzeError) throw new Error(over.analyzeError)
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); onProgress?.({ progress: 0.5 })
    fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true }); fs.writeFileSync(path.join(outDir, 'frames', 'ev_0.jpg'), JPG)
    const z = (cfg.zones || [])[0]
    const events = [
      ...(z ? [{ i: 0, t: 12.4, type: 'zone_enter', sev: 'bad', label: `คน #3 เข้าพื้นที่หวงห้าม ${z.name}`, trackId: 3, frame: true, zone: z.id, group: 'person' }] : []),
      { i: z ? 1 : 0, t: 20, type: 'crowd', sev: 'warn', label: 'พบคนหนาแน่น 9 คนในภาพพร้อมกัน', trackId: null, frame: false, group: 'person', n: 9 },
    ]
    const summary = { persons: 14, vehicles: 2, peakPersons: 9, peakPersonsAt: 20, peakVehicles: 1, peakVehiclesAt: 4,
      zones: z ? [{ id: z.id, name: z.name, kind: z.kind, entries: 5, unique: 4, peak: 2, dwellSec: 30 }] : [], lines: (cfg.lines || []).map((l) => ({ id: l.id, name: l.name, aLabel: l.aLabel, bLabel: l.bLabel, a2b: 4, b2a: 6 })), events: events.length, alerts: z ? 1 : 0 }
    const result = { config: { zones: cfg.zones || [], lines: cfg.lines || [] }, meta: { width: 1280, height: 720, fps: 25, duration: 30, sampleFps: cfg.sampleFps, samples: 150, model: 'fake', procSeconds: 0.1 }, summary, events, counts: [[0, 1, 0], [20, 9, 1]], heat: { w: 2, h: 2, data: [1, 2, 3, 4] }, frames: [[0, []]], tracks: [] }
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result))
    return { done: true, summary, meta: result.meta }
  },
})

export async function start({ worker, env = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-test-'))
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, ...env })
  const db = await openDb({ memory: true })
  const app = await createApp({ db, config, worker: worker || fakeWorker() })
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const close = async () => { await app.jobs.idle(); await new Promise((r) => server.close(r)); await db.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
  return { base, db, config, jobs: app.jobs, dataDir, close, client: (h) => client(base, h) }
}

/** Cookie-jar fetch wrapper that also carries the CSRF token. */
export function client(base) {
  let cookie = '', csrf = ''
  const call = async (method, path, body, extra = {}) => {
    const headers = { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra }
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    const sc = res.headers.getSetCookie?.() || []
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.endsWith('=')) cookie = ''; else cookie = kv }
    const type = res.headers.get('content-type') || ''
    const data = type.includes('json') ? await res.json() : await res.text()
    return { status: res.status, data, headers: res.headers }
  }
  return {
    get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p),
    async login(username, password) { const r = await call('POST', '/api/auth/login', { username, password }); if (r.data.csrf) csrf = r.data.csrf; return r },
    async setup(username, password) { const r = await call('POST', '/api/auth/setup', { username, password }); if (r.status === 201) csrf = (await call('GET', '/api/auth/me')).data.csrf; return r },
    async upload(p, buf, headers = {}) { const res = await fetch(base + p, { method: 'POST', headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), 'content-type': 'application/octet-stream', ...headers }, body: buf }); return { status: res.status, data: await res.json().catch(() => ({})) } },
    raw: async (p) => { const res = await fetch(base + p, { headers: cookie ? { cookie } : {} }); return { status: res.status, type: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()) } },
    noCsrf: (method, path, body) => { const c = csrf; csrf = ''; return call(method, path, body).finally(() => { csrf = c }) },
  }
}

export async function seedTeam(t) {
  const admin = t.client(); await admin.setup('admin', 'Adm1n-passw0rd!')
  for (const [u, role] of [['mdmd', 'md'], ['op1', 'operation'], ['op2', 'operation']]) {
    const r = await admin.post('/api/users', { username: u, displayName: u, role, password: 'Passw0rd-long-1' })
    if (r.status !== 201) throw new Error('seed failed ' + JSON.stringify(r.data))
  }
  const md = t.client(); await md.login('mdmd', 'Passw0rd-long-1')
  const s1 = t.client(); await s1.login('op1', 'Passw0rd-long-1')
  const s2 = t.client(); await s2.login('op2', 'Passw0rd-long-1')
  return { admin, md, s1, s2 }
}
