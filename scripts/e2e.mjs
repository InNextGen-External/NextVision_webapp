// End-to-end: real server + real Python worker + real browser. Uses PREVIEW_CODEC=vp9 so headless Chromium can play the preview.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CLIP = process.env.E2E_CLIP, OUT = process.env.E2E_OUT || 'e2e-out', PORT = 8099
if (!CLIP || !fs.existsSync(CLIP)) { console.error('Set E2E_CLIP=/path/to/short/video.mp4'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-e2e-'))
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: data, PREVIEW_CODEC: 'vp9', BOOTSTRAP_ADMIN_USERNAME: 'admin', BOOTSTRAP_ADMIN_PASSWORD: 'Adm1n-passw0rd!', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((res, rej) => { srv.stdout.on('data', (d) => /http:\/\/localhost/.test(String(d)) && res()); srv.on('exit', () => rej(new Error('server exited'))) })
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const errs = []; let fail = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ }
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png') })

async function login(page, u, pw) {
  await page.goto(base); await page.fill('input[name=username]', u); await page.fill('input[name=password]', pw); await page.click('form button'); await page.waitForSelector('.shell')
}
try {
  // Admin creates a Operation user
  const a = await browser.newPage({ viewport: { width: 1360, height: 900 } }); a.on('pageerror', (e) => errs.push(e.message))
  await login(a, 'admin', 'Adm1n-passw0rd!')
  const me = await (await a.request.get(base + '/api/auth/me')).json()
  const mk = await a.request.post(base + '/api/users', { headers: { 'x-csrf-token': me.csrf }, data: { username: 'op1', displayName: 'Operation One', role: 'operation', password: 'Passw0rd-long-1' } })
  ok(mk.status() === 201, 'admin creates Operation user')

  // Operation: upload -> draw -> analyse
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text()) && errs.push(m.text()))
  await login(p, 'op1', 'Passw0rd-long-1'); await shot(p, '01_dashboard_empty')
  await p.goto(base + '/#/upload'); await p.waitForSelector('#drop')
  await p.setInputFiles('#file', CLIP); await p.fill('#cust', 'ลูกค้าตัวอย่าง'); await shot(p, '02_upload')
  await p.click('#go'); await p.waitForURL(/#\/video\//)
  await p.waitForSelector('#poster', { timeout: 120000 }); await p.waitForFunction(() => document.querySelector('#poster')?.naturalWidth > 0)
  ok(true, 'clip prepared, poster shown')
  const box = await p.locator('#cv').boundingBox()
  const at = async (x, y) => p.mouse.click(box.x + box.width * x, box.y + box.height * y)
  await p.click('#tz'); for (const [x, y] of [[0.45, 0.45], [0.95, 0.45], [0.95, 0.98], [0.45, 0.98]]) await at(x, y)
  await p.click('#fin'); await p.click('#tl'); await at(0.05, 0.62); await at(0.9, 0.62)
  ok((await p.locator('.shape').count()) === 2, 'zone and line drawn')
  await p.fill('.shape[data-z="0"] input[data-f=name]', 'ทางเดินหวงห้าม')
  await p.fill('.shape[data-z="0"] input[data-f=dwellSec]', '4'); await shot(p, '03_setup')
  await p.click('#run'); await p.waitForSelector('.prog', { timeout: 10000 }); await shot(p, '04_processing')
  await p.waitForSelector('#vid', { timeout: 240000 }); ok(true, 'analysis finished, result shown')
  await p.waitForSelector('.evi'); await p.waitForFunction(() => document.querySelector('#vid').readyState >= 1, null, { timeout: 30000 }).catch(() => {})
  const n = await p.locator('.kpi .v').first().innerText(); ok(Number(n) > 0, 'persons tracked: ' + n)
  ok((await p.locator('.evi').count()) > 0, 'events listed with keyframes')
  const played = await p.evaluate(async () => { const v = document.querySelector('#vid'); try { v.currentTime = 14; await new Promise((r) => setTimeout(r, 800)); return v.readyState >= 2 } catch { return false } })
  ok(played, 'video plays in browser (preview codec)')
  await p.waitForTimeout(600); await shot(p, '05_result')
  await p.click('#sh'); await p.waitForTimeout(300); await shot(p, '06_heatmap'); await p.click('#sh')
  await p.click('#evs .evi >> nth=0'); await p.waitForTimeout(700); await shot(p, '07_event_seek')
  // ask
  await p.fill('#askbox #q', 'มีใครเข้าโซนหวงห้ามไหม'); await p.press('#askbox #q', 'Enter'); await p.waitForSelector('#askbox .msg .evs', { timeout: 10000 }); await shot(p, '08_ask')
  ok(true, 'Investigator answered with event rows')
  await p.goto(base + '/#/ask'); await p.waitForSelector('#sug .chip'); await p.click('#sug .chip >> nth=0'); await p.waitForTimeout(1200); await shot(p, '09_ask_page')
  await p.goto(base + '/#/dashboard'); await p.waitForSelector('.kpis'); await shot(p, '10_dashboard')
  await p.goto(base + '/#/videos'); await p.waitForSelector('tbody tr'); await shot(p, '11_videos')
  // Operation cannot reach admin pages; Admin sees the clip
  await p.goto(base + '/#/users'); await p.waitForTimeout(500); ok(!(await p.locator('.view').innerText()).includes('เพิ่มผู้ใช้'), 'Operation has no users page')
  await a.goto(base + '/#/videos'); await a.waitForSelector('tbody tr'); ok((await a.locator('tbody tr').count()) === 1, 'Admin sees Operation clip'); await shot(a, '12_admin_videos')
  // phone
  const ph = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 }); const m = await ph.newPage(); m.on('pageerror', (e) => errs.push(e.message))
  await login(m, 'op1', 'Passw0rd-long-1'); await m.goto(base + '/#/videos'); await m.waitForSelector('tbody tr'); await m.click('tbody tr'); await m.waitForSelector('#vid'); await m.waitForTimeout(800)
  await shot(m, '13_phone_result'); ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no horizontal scroll (result)')
  await m.click('[data-t=setup]'); await m.waitForSelector('#poster'); await m.waitForTimeout(500); await shot(m, '14_phone_setup'); ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no horizontal scroll (setup)')
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)))
} catch (e) { console.error('E2E ERROR', e); fail++ } finally { await browser.close(); srv.kill('SIGTERM'); fs.rmSync(data, { recursive: true, force: true }) }
process.exit(fail ? 1 : 0)
