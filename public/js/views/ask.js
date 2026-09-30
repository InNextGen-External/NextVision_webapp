import { get, post } from '../api.js'
import { $, esc, mmss, EVT, toast } from '../ui.js'

const SUGGEST = ['มีคนกี่คน', 'ช่วงไหนคนหนาแน่นที่สุด', 'มีใครเข้าโซนหวงห้ามไหม', 'มีคนข้ามเส้นกี่ครั้ง', 'มีรถกี่คัน', 'สรุปเหตุการณ์สำคัญ']

export function evRows(rows) {
  return rows.length ? `<div class="evs">${rows.map((r) => `<a class="evi ${r.sev}" href="#/video/${r.videoId}?t=${r.t}" style="text-decoration:none;color:inherit">${r.hasFrame ? `<img class="th" loading="lazy" alt="" src="/api/videos/${r.videoId}/events/${r.idx}/frame">` : '<span class="th">ไม่มีภาพ</span>'}<div><span class="tm">${mmss(r.t)}</span> <b>${esc(r.label)}</b><div class="xs mut">${esc(r.videoName || '')}</div></div><span class="pill ${EVT[r.type]?.[0] || 'grey'}">${esc(EVT[r.type]?.[1] || r.type)}</span></a>`).join('')}</div>` : ''
}

/** Reusable chat box. onRow(row) lets the caller handle clicks (e.g. seek) instead of navigating. */
export function chatBox(host, { videoId, placeholder = 'พิมพ์คำถามภาษาไทย', suggest = SUGGEST, onRow } = {}) {
  host.innerHTML = `<div class="chat" id="chat"><div class="msg">ถามเป็นภาษาไทยได้เลย ระบบตอบจากผลวิเคราะห์ที่บันทึกไว้เท่านั้น ไม่เดาข้อมูลนอกคลิป</div></div>
    <div class="chips" style="margin:12px 0" id="sug">${suggest.map((s) => `<button class="chip x" type="button">${esc(s)}</button>`).join('')}</div>
    <form class="row" id="f" style="flex-wrap:nowrap"><input type="text" id="q" class="grow" maxlength="300" placeholder="${esc(placeholder)}" autocomplete="off"><button class="btn pri">ถาม</button></form>`
  const chat = $('#chat', host)
  const add = (cls, html) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; chat.append(d); d.scrollIntoView({ block: 'nearest' }); return d }
  async function go(q) {
    if (!q.trim()) return
    add('me', esc(q)); const th = add('', '<span class="spin"></span> กำลังค้นจากผลวิเคราะห์…')
    try {
      const r = await post('/ask', { q, videoId })
      th.innerHTML = `${esc(r.answer)}${evRows(r.rows)}<div class="src">ตอบจากผลวิเคราะห์ ${r.scope.videos} คลิป · ${r.rows.length} เหตุการณ์อ้างอิง</div>`
      if (onRow) th.querySelectorAll('a.evi').forEach((a, i) => { a.onclick = (e) => { e.preventDefault(); onRow(r.rows[i]) } })
    } catch (e) { th.textContent = e.message; toast(e.message, true) }
  }
  $('#f', host).onsubmit = (e) => { e.preventDefault(); const i = $('#q', host); const v = i.value; i.value = ''; go(v) }
  $('#sug', host).onclick = (e) => { const b = e.target.closest('.chip'); if (b) go(b.textContent) }
}

export async function render(root) {
  const { videos } = await get('/videos?status=done')
  root.innerHTML = `<div class="stack" style="max-width:860px"><div class="notice sm">ค้นจากคลิปที่วิเคราะห์แล้ว ${videos.length} คลิป ${videos.length ? '' : '— อัปโหลดและวิเคราะห์คลิปก่อน'}</div><div class="card" id="box"></div></div>`
  chatBox($('#box', root), {})
}
