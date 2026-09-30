import test from 'node:test'
import assert from 'node:assert/strict'
import { start, seedTeam, fakeWorker } from './helpers.js'

const clip = Buffer.from('not-a-real-video-but-the-fake-worker-does-not-care')
const up = (c, name = 'demo.mp4', extra = {}) => c.upload('/api/videos/upload', clip, { 'x-file-name': encodeURIComponent(name), ...extra })
const settle = async (t, c, id, want) => {
  for (let i = 0; i < 100; i++) { await t.jobs.idle(); const v = (await c.get('/api/videos/' + id)).data.video; if (want.includes(v.status)) return v; await new Promise((r) => setTimeout(r, 30)) }
  throw new Error('timeout waiting for ' + want)
}

test('first-run setup, login, lockout, CSRF', async () => {
  const t = await start({ env: { LOGIN_LOCKOUT_ATTEMPTS: '3' } })
  try {
    const c = t.client()
    assert.equal((await c.get('/api/auth/state')).data.needsSetup, true)
    assert.equal((await c.setup('admin', 'short')).status, 400)
    assert.equal((await c.setup('admin', 'Adm1n-passw0rd!')).status, 201)
    assert.equal((await c.setup('again', 'Adm1n-passw0rd!')).status, 409)
    assert.equal((await t.client().get('/api/videos')).status, 401)
    assert.equal((await c.noCsrf('POST', '/api/ask', { q: 'x' })).status, 403)
    const u = t.client()
    for (let i = 0; i < 3; i++) assert.equal((await u.login('admin', 'wrong-password-x')).status, 401)
    assert.equal((await u.login('admin', 'Adm1n-passw0rd!')).status, 429)
  } finally { await t.close() }
})

test('permissions per role', async () => {
  const t = await start()
  try {
    const { admin, md, s1 } = await seedTeam(t)
    for (const c of [md, s1]) { assert.equal((await c.get('/api/users')).status, 403); assert.equal((await c.get('/api/settings')).status, 403); assert.equal((await c.get('/api/settings/audit')).status, 403) }
    assert.equal((await admin.get('/api/users')).status, 200); assert.equal((await admin.get('/api/settings/audit')).status, 200)
    const me = (await s1.get('/api/auth/me')).data
    assert.equal(me.user.role, 'operation'); assert.ok(me.permissions.includes('videos.use')); assert.ok(!me.permissions.includes('users.manage'))
  } finally { await t.close() }
})

test('upload -> prepare -> configure -> analyze -> results', async () => {
  const t = await start()
  try {
    const { s1 } = await seedTeam(t)
    const r = await up(s1, 'ลูกค้า ทดสอบ.mp4', { 'x-customer': encodeURIComponent('บริษัท ทดสอบ') })
    assert.equal(r.status, 201); const id = r.data.id
    const v = await settle(t, s1, id, ['ready', 'failed'])
    assert.equal(v.status, 'ready'); assert.equal(v.width, 1280); assert.equal(v.customer, 'บริษัท ทดสอบ'); assert.equal(v.name, 'ลูกค้า ทดสอบ')
    assert.equal((await s1.raw(`/api/videos/${id}/poster`)).type, 'image/jpeg')
    // zones + lines validation and normalisation
    assert.equal((await s1.patch('/api/videos/' + id, { zones: [{ name: 'x', points: [[0, 0], [1, 1]] }] })).status, 400)
    assert.equal((await s1.patch('/api/videos/' + id, { lines: [{ points: [[0, 0]] }] })).status, 400)
    const p = await s1.patch('/api/videos/' + id, { zones: [{ name: 'หน้าเครื่องจักร', kind: 'restricted', dwellSec: 5, points: [[-1, 0.2], [0.5, 0.2], [0.5, 2]] }], lines: [{ name: 'ประตู', aLabel: 'เข้า', bLabel: 'ออก', points: [[0.1, 0.5], [0.9, 0.5]] }] })
    assert.equal(p.status, 200); assert.deepEqual(p.data.video.zones[0].points[0], [0, 0.2]); assert.equal(p.data.video.zones[0].points[2][1], 1)
    assert.equal((await s1.post(`/api/videos/${id}/analyze`)).status, 202)
    const done = await settle(t, s1, id, ['done', 'failed'])
    assert.equal(done.status, 'done'); assert.equal(done.summary.persons, 14)
    const res = (await s1.get(`/api/videos/${id}/result`)).data
    assert.equal(res.events.length, 2); assert.equal(res.events[0].type, 'zone_enter'); assert.ok(res.events[0].frame); assert.ok(!res.events[1].frame)
    assert.equal((await s1.raw(`/api/videos/${id}/events/0/frame`)).type, 'image/jpeg')
    assert.equal((await s1.raw(`/api/videos/${id}/events/1/frame`)).status, 404)
    // re-analysing replaces results, does not duplicate
    await s1.post(`/api/videos/${id}/analyze`); await settle(t, s1, id, ['done'])
    assert.equal((await s1.get(`/api/videos/${id}/result`)).data.events.length, 2)
    assert.equal((await s1.get('/api/reports/summary')).data.alerts, 1)
  } finally { await t.close() }
})

test('upload guards: extension, size, empty, CSRF', async () => {
  const t = await start({ env: { MAX_UPLOAD_MB: '1' } })
  try {
    const { s1 } = await seedTeam(t)
    assert.equal((await up(s1, 'virus.exe')).status, 400)
    assert.equal((await s1.upload('/api/videos/upload', Buffer.alloc(0), { 'x-file-name': 'a.mp4' })).status, 400)
    assert.equal((await s1.upload('/api/videos/upload', Buffer.alloc(1.2 * 1024 * 1024), { 'x-file-name': 'big.mp4' })).status, 413)
    assert.equal((await t.client().upload('/api/videos/upload', clip, { 'x-file-name': 'a.mp4' })).status, 401)
    const nocsrf = await s1.noCsrf('POST', '/api/videos/upload', clip)
    assert.equal(nocsrf.status, 403)
  } finally { await t.close() }
})

test('Operation scoping: own clips only; MD/Admin see all; delete rules', async () => {
  const t = await start()
  try {
    const { admin, md, s1, s2 } = await seedTeam(t)
    const a = (await up(s1, 'one.mp4')).data.id; await settle(t, s1, a, ['ready'])
    assert.equal((await s2.get('/api/videos/' + a)).status, 404)
    assert.equal((await s2.patch('/api/videos/' + a, { name: 'hack' })).status, 404)
    assert.equal((await s2.get('/api/videos')).data.videos.length, 0)
    assert.equal((await md.get('/api/videos')).data.videos.length, 1)
    assert.equal((await md.patch('/api/videos/' + a, { name: 'renamed by md' })).status, 200)
    assert.equal((await s2.del('/api/videos/' + a)).status, 404)
    assert.equal((await s1.del('/api/videos/' + a)).status, 200)
    assert.equal((await admin.get('/api/videos')).data.videos.length, 0)
  } finally { await t.close() }
})

test('failures are reported and recoverable', async () => {
  const t = await start({ worker: fakeWorker({ prepareError: 'คลิปยาว 900 วินาที เกินกำหนด' }) })
  try {
    const { s1 } = await seedTeam(t)
    const id = (await up(s1)).data.id; const v = await settle(t, s1, id, ['failed'])
    assert.match(v.error, /เกินกำหนด/)
  } finally { await t.close() }
  const t2 = await start({ worker: fakeWorker({ analyzeError: 'โมเดลล้มเหลว' }) })
  try {
    const { s1 } = await seedTeam(t2)
    const id = (await up(s1)).data.id; await settle(t2, s1, id, ['ready'])
    await s1.post(`/api/videos/${id}/analyze`); const v = await settle(t2, s1, id, ['failed'])
    assert.equal(v.prepared, true); assert.match(v.error, /โมเดล/)
    assert.equal((await s1.post(`/api/videos/${id}/analyze`)).status, 202) // can retry
  } finally { await t2.close() }
})

test('Investigator answers only from recorded results', async () => {
  const t = await start()
  try {
    const { s1, s2 } = await seedTeam(t)
    assert.match((await s1.post('/api/ask', { q: 'มีคนกี่คน' })).data.answer, /ยังไม่มีคลิป/)
    const id = (await up(s1)).data.id; await settle(t, s1, id, ['ready'])
    await s1.patch('/api/videos/' + id, { zones: [{ name: 'โซนเครื่องจักร', points: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.9]] }], lines: [{ name: 'ประตู', aLabel: 'เข้า', bLabel: 'ออก', points: [[0.1, 0.5], [0.9, 0.5]] }] })
    await s1.post(`/api/videos/${id}/analyze`); await settle(t, s1, id, ['done'])
    let a = (await s1.post('/api/ask', { q: 'มีคนกี่คน', videoId: id })).data
    assert.match(a.answer, /14 คน/)
    a = (await s1.post('/api/ask', { q: 'มีใครเข้าโซนหวงห้ามไหม' })).data
    assert.match(a.answer, /เข้า 5 ครั้ง/); assert.equal(a.rows[0].type, 'zone_enter'); assert.equal(a.rows[0].idx, 0)
    a = (await s1.post('/api/ask', { q: 'มีคนข้ามเส้นกี่ครั้ง' })).data
    assert.match(a.answer, /เข้า→ออก 4/)
    a = (await s1.post('/api/ask', { q: 'ช่วงไหนคนหนาแน่นที่สุด' })).data
    assert.match(a.answer, /9 คน/); assert.match(a.answer, /00:20/)
    a = (await s1.post('/api/ask', { q: 'สวัสดีอากาศวันนี้เป็นไง' })).data
    assert.match(a.answer, /ยังไม่เข้าใจ/); assert.equal(a.rows.length, 0)
    assert.match((await s2.post('/api/ask', { q: 'มีคนกี่คน' })).data.answer, /ยังไม่มีคลิป/) // Operation 2 cannot see Operation 1 data
  } finally { await t.close() }
})

test('settings validation', async () => {
  const t = await start()
  try {
    const { admin } = await seedTeam(t)
    assert.equal((await admin.put('/api/settings', { sampleFps: 99 })).status, 400)
    assert.equal((await admin.put('/api/settings', { sampleFps: 8, crowdThreshold: 5 })).data.settings.sampleFps, 8)
  } finally { await t.close() }
})
