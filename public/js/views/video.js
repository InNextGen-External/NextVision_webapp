import { get, post, patch, del } from '../api.js'
import { $, $$, esc, toast, busy, confirmBox, ask as askModal, vpill, mmss, dur, bytes, dt, EVT } from '../ui.js'
import { chatBox } from './ask.js'

const BUSY = ['preparing', 'queued', 'processing']
const Y = '#ffcc00', BLUE = '#7fb6ff', WHITE = '#ffffff'
const uid = (p, list) => { let n = list.length + 1; while (list.some((x) => x.id === p + n)) n++; return p + n }

export async function render(root, ctx) {
  const { arg, q, alive, refreshBadge } = ctx
  let v = (await get('/videos/' + arg)).video
  let tab = v.status === 'done' && !q.edit ? 'result' : 'setup'
  let seekTo = q.t != null ? Number(q.t) : null
  let poll

  async function reload() { v = (await get('/videos/' + arg)).video; refreshBadge?.() }

  function head() {
    return `<div class="hd"><div><h2 style="font-size:22px;margin:0">${esc(v.name)}</h2><div class="sm mut">${v.customer ? esc(v.customer) + ' · ' : ''}${esc(v.fileName)} · ${bytes(v.sizeBytes)}${v.duration ? ' · ' + dur(v.duration) : ''}${v.width ? ` · ${v.width}×${v.height}` : ''}${v.ownerName ? ' · โดย ' + esc(v.ownerName) : ''}</div></div>
      <div class="row">${vpill(v.status)}<button class="btn sm" id="ren">เปลี่ยนชื่อ</button><button class="btn sm danger" id="del">ลบคลิป</button></div></div>`
  }
  function wireHead() {
    $('#ren', root).onclick = async () => {
      const r = await askModal('เปลี่ยนชื่อ', `<label class="f"><span>ชื่อคลิป</span><input type="text" name="name" value="${esc(v.name)}" maxlength="120" required></label><label class="f"><span>ลูกค้า / โครงการ</span><input type="text" name="customer" value="${esc(v.customer)}" maxlength="120"></label>`)
      if (!r) return
      try { await patch('/videos/' + v.id, r); await reload(); draw() } catch (e) { toast(e.message, true) }
    }
    $('#del', root).onclick = async () => {
      if (!(await confirmBox({ title: 'ลบคลิปนี้?', body: 'ลบไฟล์วิดีโอและผลวิเคราะห์ทั้งหมดถาวร กู้คืนไม่ได้', ok: 'ลบถาวร', danger: true }))) return
      try { await del('/videos/' + v.id); toast('ลบคลิปแล้ว'); refreshBadge?.(); location.hash = '#/videos' } catch (e) { toast(e.message, true) }
    }
  }

  function draw() {
    clearInterval(poll)
    if (BUSY.includes(v.status)) return drawBusy()
    if (v.status === 'failed' && !v.prepared) {
      root.innerHTML = `<div class="stack">${head()}<div class="notice"><b>เตรียมคลิปไม่สำเร็จ</b><div class="sm" style="margin-top:4px">${esc(v.error)}</div></div><div class="row"><a class="btn pri" href="#/upload">อัปโหลดใหม่</a></div></div>`
      return wireHead()
    }
    root.innerHTML = `<div class="stack">${head()}
      ${v.status === 'failed' ? `<div class="notice"><b>วิเคราะห์ไม่สำเร็จ</b><div class="sm" style="margin-top:4px">${esc(v.error)}</div></div>` : ''}
      <div class="tabs"><button data-t="result" class="${tab === 'result' ? 'on' : ''}" ${v.summary ? '' : 'disabled style="opacity:.4"'}>ผลลัพธ์</button><button data-t="setup" class="${tab === 'setup' ? 'on' : ''}">ตั้งค่าและวิเคราะห์</button></div><div id="tab"></div></div>`
    wireHead()
    $$('[data-t]', root).forEach((b) => b.onclick = () => { if (b.disabled) return; tab = b.dataset.t; draw() })
    tab === 'result' && v.summary ? resultTab($('#tab', root)) : setupTab($('#tab', root))
  }

  function drawBusy() {
    const label = { preparing: 'กำลังแปลงคลิปให้เล่นในเว็บได้', queued: 'อยู่ในคิว รอคลิปก่อนหน้าเสร็จ', processing: 'กำลังตรวจจับและติดตามคนกับยานพาหนะ' }
    root.innerHTML = `<div class="stack">${head()}<div class="card"><div class="row"><span class="spin"></span><b>${label[v.status]}</b></div>
      <div class="prog" style="margin-top:12px"><i style="width:${Math.round((v.status === 'processing' ? v.progress : 0) * 100)}%"></i></div>
      <p class="sm mut" style="margin:10px 0 0">${v.status === 'processing' ? Math.round(v.progress * 100) + '% · ปิดหน้านี้ได้ ระบบทำงานต่อและแจ้งสถานะในรายการคลิป' : 'ขั้นตอนนี้ใช้เวลาตามความยาวและความละเอียดของคลิป'}</p></div></div>`
    wireHead()
    poll = setInterval(async () => {
      if (!root.isConnected || !alive()) return clearInterval(poll)
      try { const was = v.status; await reload(); if (v.status !== was || v.status === 'processing') { if (BUSY.includes(v.status)) drawBusy(); else { tab = v.status === 'done' ? 'result' : 'setup'; draw() } } } catch {}
    }, 2000)
  }

  // ------------------------------------------------------------------ setup: draw zones / lines on the poster
  function setupTab(c) {
    const zones = structuredClone(v.zones), lines = structuredClone(v.lines), modules = { ...v.modules }
    let tool = null, cur = [], hover = null
    c.innerHTML = `<div class="split"><div class="stack"><div class="tool"><button class="btn sm" id="tz">+ วาดโซน</button><button class="btn sm" id="tl">+ วาดเส้นนับ</button><button class="btn sm" id="fin" style="display:none">เสร็จสิ้นโซน</button><button class="btn sm ghost" id="cn" style="display:none">ยกเลิก</button><span class="sm mut" id="hint">เลือกเครื่องมือ แล้วคลิกบนภาพ</span></div>
        <div class="stage draw" id="stage"><img id="poster" alt="ภาพตัวอย่างจากคลิป" src="/api/videos/${v.id}/poster"><canvas id="cv"></canvas></div></div>
      <div class="stack"><div class="card"><h3 style="margin-bottom:8px">โมดูลที่ใช้</h3>
        <label class="row"><input type="checkbox" checked disabled><span><b>นับคนและยานพาหนะ</b><br><span class="xs mut">ติดตามทีละคน/คัน (เปิดเสมอ)</span></span></label>
        ${[['zone', 'โซนหวงห้าม / นับในโซน'], ['line', 'นับข้ามเส้น'], ['crowd', 'เตือนคนหนาแน่น']].map(([k, n]) => `<label class="row"><input type="checkbox" data-m="${k}" ${modules[k] ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
        <div id="shapes" class="stack"></div>
        <button class="btn pri" id="run" style="width:100%">${v.summary ? 'บันทึกและวิเคราะห์ใหม่' : 'บันทึกและเริ่มวิเคราะห์'}</button>
        <p class="xs mut" style="margin:0">ไม่วาดโซนหรือเส้นก็ได้ ระบบจะนับคนและยานพาหนะให้อยู่แล้ว</p></div></div>`
    const img = $('#poster', c), cv = $('#cv', c), cx = cv.getContext('2d'), stage = $('#stage', c)
    const hint = $('#hint', c)

    function size() { const r = stage.getBoundingClientRect(), d = window.devicePixelRatio || 1; cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); paint() }
    const P = (p) => [p[0] * cv.width, p[1] * cv.height]
    function path(pts, close) { cx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); i ? cx.lineTo(x, y) : cx.moveTo(x, y) }); if (close) cx.closePath() }
    function arrow(l) {
      const [a, b] = l.points.map(P), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1
      const nx = -dy / L, ny = dx / L, s = Math.max(18, cv.width * 0.035)
      cx.strokeStyle = WHITE; cx.fillStyle = WHITE; cx.lineWidth = 2 * (window.devicePixelRatio || 1)
      cx.beginPath(); cx.moveTo(mx - nx * s, my - ny * s); cx.lineTo(mx + nx * s, my + ny * s); cx.stroke()
      cx.beginPath(); cx.moveTo(mx + nx * s, my + ny * s); cx.lineTo(mx + nx * s - nx * 8 - ny * 6, my + ny * s - ny * 8 + nx * 6); cx.lineTo(mx + nx * s - nx * 8 + ny * 6, my + ny * s - ny * 8 - nx * 6); cx.closePath(); cx.fill()
      cx.font = `600 ${12 * (window.devicePixelRatio || 1)}px sans-serif`; cx.fillText(l.aLabel, mx - nx * (s + 22) - 10, my - ny * (s + 22) + 4); cx.fillText(l.bLabel, mx + nx * (s + 22) - 10, my + ny * (s + 22) + 4)
    }
    function paint() {
      cx.clearRect(0, 0, cv.width, cv.height); const d = window.devicePixelRatio || 1
      zones.forEach((z) => { const col = z.kind === 'monitor' ? BLUE : Y; path(z.points, true); cx.fillStyle = col + '33'; cx.fill(); cx.strokeStyle = col; cx.lineWidth = 2 * d; cx.stroke(); const [x, y] = P(z.points[0]); cx.fillStyle = col; cx.font = `600 ${13 * d}px sans-serif`; cx.fillText(z.name, x + 6, y + 16 * d) })
      lines.forEach((l) => { path(l.points, false); cx.strokeStyle = WHITE; cx.lineWidth = 3 * d; cx.stroke(); arrow(l); cx.fillStyle = WHITE; cx.font = `600 ${13 * d}px sans-serif`; const [x, y] = P(l.points[0]); cx.fillText(l.name, x + 6, y - 8 * d) })
      if (tool && cur.length) {
        const pts = hover ? [...cur, hover] : cur; path(pts, false); cx.strokeStyle = tool === 'zone' ? Y : WHITE; cx.lineWidth = 2 * d; cx.setLineDash([6 * d, 4 * d]); cx.stroke(); cx.setLineDash([])
        cur.forEach((p, i) => { const [x, y] = P(p); cx.fillStyle = i === 0 ? Y : WHITE; cx.beginPath(); cx.arc(x, y, (i === 0 ? 6 : 4) * d, 0, 7); cx.fill() })
      }
    }
    const norm = (e) => { const r = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] }
    function setTool(t) {
      tool = t; cur = []; hover = null
      $('#tz', c).classList.toggle('on', t === 'zone'); $('#tl', c).classList.toggle('on', t === 'line')
      $('#fin', c).style.display = t === 'zone' ? '' : 'none'; $('#cn', c).style.display = t ? '' : 'none'
      hint.textContent = t === 'zone' ? 'คลิกเพื่อวางจุดมุมของโซน (อย่างน้อย 3 จุด) แล้วกด “เสร็จสิ้นโซน” หรือคลิกจุดแรกอีกครั้ง' : t === 'line' ? 'คลิก 2 จุดเพื่อลากเส้นนับ' : 'เลือกเครื่องมือ แล้วคลิกบนภาพ'
      stage.style.cursor = t ? 'crosshair' : ''; paint()
    }
    function finishZone() {
      if (cur.length < 3) return toast('โซนต้องมีอย่างน้อย 3 จุด', true)
      if (zones.length >= 8) return toast('กำหนดโซนได้สูงสุด 8 โซน', true)
      zones.push({ id: uid('z', zones), name: `โซน ${zones.length + 1}`, kind: 'restricted', cls: 'person', dwellSec: 0, points: cur }); setTool(null); list()
    }
    cv.addEventListener('pointerdown', (e) => {
      if (!tool) return; e.preventDefault(); const p = norm(e)
      if (tool === 'zone') {
        if (cur.length >= 3) { const [fx, fy] = P(cur[0]), [px, py] = P(p); if (Math.hypot(fx - px, fy - py) < 14 * (window.devicePixelRatio || 1)) return finishZone() }
        if (cur.length >= 24) return toast('โซนมีได้สูงสุด 24 จุด', true)
        cur = [...cur, p]; paint()
      } else {
        cur = [...cur, p]
        if (cur.length === 2) { if (lines.length >= 8) { setTool(null); return toast('กำหนดเส้นได้สูงสุด 8 เส้น', true) } lines.push({ id: uid('l', lines), name: `เส้น ${lines.length + 1}`, cls: 'person', aLabel: 'ฝั่ง A', bLabel: 'ฝั่ง B', points: cur }); setTool(null); list() } else paint()
      }
    })
    cv.addEventListener('pointermove', (e) => { if (tool && cur.length) { hover = norm(e); paint() } })
    $('#tz', c).onclick = () => setTool(tool === 'zone' ? null : 'zone'); $('#tl', c).onclick = () => setTool(tool === 'line' ? null : 'line')
    $('#fin', c).onclick = finishZone; $('#cn', c).onclick = () => setTool(null)
    $$('[data-m]', c).forEach((b) => b.onchange = () => { modules[b.dataset.m] = b.checked })

    function list() {
      const box = $('#shapes', c)
      box.innerHTML = [...zones.map((z, i) => `<div class="shape" data-z="${i}"><div class="sh"><span class="sw" style="background:${z.kind === 'monitor' ? BLUE : Y}"></span><input type="text" class="grow" data-f="name" value="${esc(z.name)}" maxlength="60" aria-label="ชื่อโซน"><button class="btn sm danger" data-rm>ลบ</button></div>
          <div class="opts"><select data-f="kind" aria-label="ชนิดโซน"><option value="restricted" ${z.kind === 'restricted' ? 'selected' : ''}>หวงห้าม (แจ้งเตือนสูง)</option><option value="monitor" ${z.kind === 'monitor' ? 'selected' : ''}>เฝ้าดู (นับเฉยๆ)</option></select>
          <select data-f="cls" aria-label="ประเภทที่ตรวจ"><option value="person" ${z.cls === 'person' ? 'selected' : ''}>คน</option><option value="vehicle" ${z.cls === 'vehicle' ? 'selected' : ''}>ยานพาหนะ</option></select>
          <label class="xs mut">แจ้งเมื่ออยู่นาน <input type="number" data-f="dwellSec" min="0" max="3600" value="${z.dwellSec}" style="width:72px"> วินาที (0 = ปิด)</label></div></div>`),
        ...lines.map((l, i) => `<div class="shape" data-l="${i}"><div class="sh"><span class="sw" style="background:${WHITE}"></span><input type="text" class="grow" data-f="name" value="${esc(l.name)}" maxlength="60" aria-label="ชื่อเส้น"><button class="btn sm danger" data-rm>ลบ</button></div>
          <div class="opts"><select data-f="cls" aria-label="ประเภทที่นับ"><option value="person" ${l.cls === 'person' ? 'selected' : ''}>คน</option><option value="vehicle" ${l.cls === 'vehicle' ? 'selected' : ''}>ยานพาหนะ</option></select>
          <input type="text" data-f="aLabel" value="${esc(l.aLabel)}" maxlength="20" style="width:92px" aria-label="ชื่อฝั่งต้นทาง"><span class="xs mut">→</span><input type="text" data-f="bLabel" value="${esc(l.bLabel)}" maxlength="20" style="width:92px" aria-label="ชื่อฝั่งปลายทาง"><button class="btn sm" data-flip title="สลับทิศลูกศร">สลับทิศ</button></div>
          <div class="xs mut">นับเมื่อข้ามตามทิศลูกศร = ${esc(l.aLabel)}→${esc(l.bLabel)}</div></div>`)].join('') || '<div class="xs mut">ยังไม่ได้วาดโซนหรือเส้น</div>'
      paint()
    }
    $('#shapes', c).oninput = (e) => {
      const s = e.target.closest('.shape'), f = e.target.dataset.f; if (!s || !f) return
      const o = s.dataset.z != null ? zones[s.dataset.z] : lines[s.dataset.l]; o[f] = f === 'dwellSec' ? Number(e.target.value) || 0 : e.target.value
      if (['kind', 'cls'].includes(f)) list(); else paint()
    }
    $('#shapes', c).onclick = (e) => {
      const s = e.target.closest('.shape'); if (!s) return
      if (e.target.closest('[data-rm]')) { s.dataset.z != null ? zones.splice(s.dataset.z, 1) : lines.splice(s.dataset.l, 1); list() }
      if (e.target.closest('[data-flip]')) { const l = lines[s.dataset.l]; l.points = [l.points[1], l.points[0]]; list() }
    }
    $('#run', c).onclick = (e) => busy(e.target, async () => {
      try {
        await patch('/videos/' + v.id, { zones, lines, modules }); await post(`/videos/${v.id}/analyze`)
        toast('เริ่มวิเคราะห์แล้ว'); await reload(); tab = 'result'; draw()
      } catch (x) { toast(x.message, true) }
    })
    img.onload = size; new ResizeObserver(size).observe(stage); if (img.complete) size(); list()
  }

  // ------------------------------------------------------------------ result: player + overlay, chart, events, ask
  async function resultTab(c) {
    c.innerHTML = '<div class="empty"><span class="spin"></span></div>'
    const { result: r, events } = await get(`/videos/${v.id}/result`)
    if (!alive()) return
    const S = r.summary, cfg = r.config || { zones: v.zones, lines: v.lines }, show = { boxes: true, shapes: true, heat: false }
    const frames = r.frames, dur_ = r.meta.duration
    c.innerHTML = `<div class="stack">
      <div class="kpis"><div class="kpi hot"><div class="l">คนที่ติดตามได้</div><div class="v mono">${S.persons}</div></div><div class="kpi"><div class="l">ยานพาหนะที่ติดตามได้</div><div class="v mono">${S.vehicles}</div></div>
        <button class="kpi" id="pk" style="text-align:left;cursor:pointer;color:inherit"><div class="l">คนมากสุดพร้อมกัน · ที่ ${mmss(S.peakPersonsAt)}</div><div class="v mono">${S.peakPersons}</div></button>
        <div class="kpi"><div class="l">เหตุการณ์ · แจ้งเตือนสูง</div><div class="v mono">${S.events} · <span style="color:${S.alerts ? 'var(--bad)' : 'inherit'}">${S.alerts}</span></div></div></div>
      <div class="split"><div class="stack">
        <div class="stage" id="stage"><video id="vid" controls playsinline preload="metadata" src="/api/videos/${v.id}/file"></video><canvas id="ov" style="pointer-events:none"></canvas></div>
        <div class="row"><label class="row" style="margin:0"><input type="checkbox" id="sb" checked><span class="sm">กรอบตรวจจับ</span></label><label class="row" style="margin:0"><input type="checkbox" id="ss" checked><span class="sm">โซน/เส้น</span></label><label class="row" style="margin:0"><input type="checkbox" id="sh"><span class="sm">แผนที่ความหนาแน่น</span></label>
          <span class="legend" style="margin-left:auto"><span><i style="background:${Y}"></i>คน</span><span><i style="background:${WHITE}"></i>ยานพาหนะ</span></span></div>
        <div class="notice warn sm hide" id="verr">เบราว์เซอร์เล่นไฟล์วิดีโอนี้ไม่ได้ ใช้ภาพเหตุการณ์ด้านขวาและกราฟแทน</div>
        <div class="card"><div class="hd"><h3>จำนวนในภาพตามเวลา</h3><span class="xs mut">คลิกกราฟเพื่อข้ามไปจุดนั้น · สูงสุดต่อช่วง</span></div><div id="chart"></div></div></div>
        <div class="stack"><div class="card"><div class="hd"><h3>เหตุการณ์</h3><button class="btn sm" id="csv">ส่งออก CSV</button></div>
          <div class="chips" id="flt" style="margin:10px 0"></div><div class="evs" id="evs"></div></div></div></div>
      ${S.zones.length || S.lines.length ? `<div class="cols">${S.zones.length ? `<div class="card"><h3 style="margin-bottom:8px">โซน</h3><div class="tw"><table><thead><tr><th>โซน</th><th class="num">เข้า (ครั้ง)</th><th class="num">ไม่ซ้ำ</th><th class="num">มากสุดพร้อมกัน</th></tr></thead><tbody>${S.zones.map((z) => `<tr><td>${esc(z.name)} <span class="pill ${z.kind === 'monitor' ? 'blue' : 'red'}">${z.kind === 'monitor' ? 'เฝ้าดู' : 'หวงห้าม'}</span></td><td class="num mono">${z.entries}</td><td class="num mono">${z.unique}</td><td class="num mono">${z.peak}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        ${S.lines.length ? `<div class="card"><h3 style="margin-bottom:8px">เส้นนับ</h3><div class="tw"><table><thead><tr><th>เส้น</th><th class="num">ทิศตามลูกศร</th><th class="num">ทิศตรงข้าม</th></tr></thead><tbody>${S.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num mono">${esc(l.aLabel)}→${esc(l.bLabel)} <b>${l.a2b}</b></td><td class="num mono">${esc(l.bLabel)}→${esc(l.aLabel)} <b>${l.b2a}</b></td></tr>`).join('')}</tbody></table></div></div>` : ''}</div>` : ''}
      <div class="card"><h3 style="margin-bottom:10px">ถามระบบเกี่ยวกับคลิปนี้</h3><div id="askbox"></div></div>
      <p class="xs mut">วิเคราะห์ด้วยโมเดล ${esc(r.meta.model)} · ${r.meta.sampleFps} เฟรม/วินาที · ใช้เวลาประมวลผล ${r.meta.procSeconds} วินาที · ตัวเลขเป็นผลที่ระบบติดตามได้ในคลิปนี้ ไม่ใช่ตัวเลขความแม่นยำ คนเดียวกันที่หลุดจากภาพแล้วกลับมาอาจถูกนับซ้ำ</p></div>`
    const vid = $('#vid', c), cv = $('#ov', c), cx = cv.getContext('2d'), stage = $('#stage', c)
    vid.onerror = () => $('#verr', c).classList.remove('hide')

    // --- overlay
    const d = () => window.devicePixelRatio || 1
    function fit() { const b = stage.getBoundingClientRect(); cv.width = Math.round(b.width * d()); cv.height = Math.round(b.height * d()); paint() }
    function at(t) {
      let lo = 0, hi = frames.length - 1
      while (lo < hi) { const m = (lo + hi + 1) >> 1; frames[m][0] <= t ? lo = m : hi = m - 1 }
      const a = frames[lo], b = frames[lo + 1]; if (!a || t - a[0] > 1) return []
      if (!b || b[0] - a[0] > 1) return a[1]
      const k = (t - a[0]) / (b[0] - a[0]), nb = new Map(b[1].map((x) => [x[0], x]))
      return a[1].map((x) => { const y = nb.get(x[0]); return y ? [x[0], x[1], x[2] + (y[2] - x[2]) * k, x[3] + (y[3] - x[3]) * k, x[4] + (y[4] - x[4]) * k, x[5] + (y[5] - x[5]) * k] : x })
    }
    function heat() {
      const { w, h, data } = r.heat, mx = Math.max(1, ...data), cw = cv.width / w, ch = cv.height / h
      data.forEach((n, i) => { if (!n) return; const k = Math.sqrt(n / mx); cx.fillStyle = `rgba(255,${Math.round(200 - 150 * k)},0,${0.12 + 0.5 * k})`; cx.fillRect((i % w) * cw, Math.floor(i / w) * ch, cw + 1, ch + 1) })
    }
    function shapes() {
      const W = cv.width, H = cv.height, dd = d()
      ;(cfg.zones || []).forEach((z) => { const col = z.kind === 'monitor' ? BLUE : Y; cx.beginPath(); z.points.forEach((p, i) => i ? cx.lineTo(p[0] * W, p[1] * H) : cx.moveTo(p[0] * W, p[1] * H)); cx.closePath(); cx.fillStyle = col + '2a'; cx.fill(); cx.strokeStyle = col; cx.lineWidth = 2 * dd; cx.stroke(); cx.fillStyle = col; cx.font = `600 ${12 * dd}px sans-serif`; cx.fillText(z.name, z.points[0][0] * W + 6, z.points[0][1] * H + 15 * dd) })
      ;(cfg.lines || []).forEach((l) => { cx.beginPath(); cx.moveTo(l.points[0][0] * W, l.points[0][1] * H); cx.lineTo(l.points[1][0] * W, l.points[1][1] * H); cx.strokeStyle = WHITE; cx.lineWidth = 3 * dd; cx.stroke() })
    }
    function paint() {
      cx.clearRect(0, 0, cv.width, cv.height); const dd = d()
      if (show.heat) heat(); if (show.shapes) shapes()
      if (show.boxes) at(vid.currentTime).forEach(([id, g, x, y, w, h]) => {
        const col = g === 0 ? Y : WHITE, X = x * cv.width, Yy = y * cv.height, Wd = w * cv.width, Hd = h * cv.height
        cx.strokeStyle = col; cx.lineWidth = 2 * dd; cx.strokeRect(X, Yy, Wd, Hd); cx.fillStyle = col; cx.font = `600 ${11 * dd}px sans-serif`
        const tx = `#${id}`, tw = cx.measureText(tx).width + 8 * dd; cx.fillRect(X, Math.max(0, Yy - 15 * dd), tw, 15 * dd); cx.fillStyle = '#111'; cx.fillText(tx, X + 4 * dd, Math.max(11 * dd, Yy - 4 * dd))
      })
      const cur = $('#cur', c); if (cur) { const x = 40 + (vid.currentTime / dur_) * 660; cur.setAttribute('x1', x); cur.setAttribute('x2', x) }
    }
    let raf; const loop = () => { paint(); if (!vid.paused && !vid.ended && root.isConnected) raf = requestAnimationFrame(loop) }
    vid.onplay = () => { cancelAnimationFrame(raf); loop() }; ;['seeked', 'timeupdate', 'loadedmetadata', 'pause'].forEach((ev) => vid.addEventListener(ev, paint))
    new ResizeObserver(fit).observe(stage); fit()
    const seek = (t, play = true) => { vid.currentTime = Math.max(0, Math.min(dur_, t)); paint(); if (play) vid.play().catch(() => {}); stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
    $('#sb', c).onchange = (e) => { show.boxes = e.target.checked; paint() }; $('#ss', c).onchange = (e) => { show.shapes = e.target.checked; paint() }; $('#sh', c).onchange = (e) => { show.heat = e.target.checked; paint() }
    $('#pk', c).onclick = () => seek(Math.max(0, S.peakPersonsAt - 1), true)

    // --- chart (one scale for marks, ticks and labels)
    const pts = r.counts, mx = Math.max(1, ...pts.map((p) => Math.max(p[1], p[2]))), X = (t) => 40 + (t / dur_) * 660, Yc = (n) => 130 - (n / mx) * 110
    const line = (i) => pts.map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Yc(p[i]).toFixed(1)}`).join(' ')
    const ticks = Array.from({ length: 6 }, (_, i) => (dur_ * i) / 5)
    $('#chart', c).innerHTML = `<svg class="chart" viewBox="0 0 720 160" role="img" aria-label="กราฟจำนวนคนและยานพาหนะตามเวลา">
      ${[0, 0.5, 1].map((k) => `<line x1="40" x2="700" y1="${Yc(mx * k)}" y2="${Yc(mx * k)}" stroke="#2d2d32" stroke-width="1"/><text x="34" y="${Yc(mx * k) + 4}" text-anchor="end">${Math.round(mx * k)}</text>`).join('')}
      <path d="${line(1)} L${X(pts.at(-1)[0])},${Yc(0)} L${X(pts[0][0])},${Yc(0)} Z" fill="${Y}" opacity=".14"/><path d="${line(1)}" fill="none" stroke="${Y}" stroke-width="2"/>
      ${pts.some((p) => p[2]) ? `<path d="${line(2)}" fill="none" stroke="${WHITE}" stroke-width="1.5" stroke-dasharray="4 3"/>` : ''}
      <circle cx="${X(S.peakPersonsAt)}" cy="${Yc(S.peakPersons)}" r="4" fill="${Y}"/>
      ${ticks.map((t) => `<text x="${X(t)}" y="152" text-anchor="middle">${mmss(t)}</text>`).join('')}
      <line id="cur" x1="40" x2="40" y1="14" y2="130" stroke="${BLUE}" stroke-width="1.5"/></svg>`
    $('#chart', c).onclick = (e) => { const b = e.currentTarget.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * 720; seek(((x - 40) / 660) * dur_, false) }

    // --- events
    let flt = ''
    const types = [...new Set(events.map((e) => e.type))]
    function evs() {
      $('#flt', c).innerHTML = [['', 'ทั้งหมด'], ...types.map((t) => [t, EVT[t]?.[1] || t])].map(([k, n]) => `<button class="chip x" data-k="${k}" style="${flt === k ? 'border-color:var(--red);color:#fff' : ''}">${esc(n)}</button>`).join('')
      const list = events.filter((e) => !flt || e.type === flt)
      $('#evs', c).innerHTML = list.length ? list.slice(0, 200).map((e) => `<button class="evi ${e.sev}" data-t="${e.t}">${e.frame ? `<img class="th" loading="lazy" alt="" src="/api/videos/${v.id}/events/${e.i}/frame">` : '<span class="th">ไม่มีภาพ</span>'}<div><span class="tm">${mmss(e.t)}</span> <b>${esc(e.label)}</b></div><span class="pill ${EVT[e.type]?.[0] || 'grey'}">${esc(EVT[e.type]?.[1] || e.type)}</span></button>`).join('') + (list.length > 200 ? `<div class="xs mut">แสดง 200 จาก ${list.length} รายการ ดูทั้งหมดได้จากไฟล์ CSV</div>` : '') : '<div class="empty" style="padding:16px">ไม่มีเหตุการณ์ในคลิปนี้</div>'
    }
    $('#flt', c).onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { flt = b.dataset.k; evs() } }
    $('#evs', c).onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) seek(Math.max(0, Number(b.dataset.t) - 1.5)) }
    evs()
    $('#csv', c).onclick = () => {
      const rows = [['time_s', 'time', 'type', 'severity', 'label', 'track_id'], ...events.map((e) => [e.t, mmss(e.t), e.type, e.sev, e.label, e.trackId ?? ''])]
      const csv = '﻿' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n')
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `${v.name.replace(/[^\w฀-๿-]+/g, '_')}_events.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    }
    chatBox($('#askbox', c), { videoId: v.id, onRow: (row) => seek(Math.max(0, row.t - 1.5)) })
    if (seekTo != null) { const t = seekTo; seekTo = null; vid.addEventListener('loadedmetadata', () => { vid.currentTime = Math.max(0, t - 1.5); paint() }, { once: true }) }
  }

  draw()
}
