import { get, put } from '../api.js'
import { $, $$, esc, dt, toast, busy } from '../ui.js'

export async function render(root) {
  let tab = 'gen'
  async function draw() {
    root.innerHTML = `<div class="stack"><div class="tabs">${[['gen', 'ทั่วไป'], ['audit', 'บันทึกการใช้งาน']].map(([k, n]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><div id="c"></div></div>`
    const c = $('#c', root)
    if (tab === 'gen') {
      const { settings: s } = await get('/settings')
      c.innerHTML = `<form class="card" id="f" style="max-width:560px"><label class="f"><span>ชื่อองค์กร (แสดงหน้าเข้าสู่ระบบ)</span><input type="text" name="companyName" value="${esc(s.companyName)}" maxlength="100"></label>
        <label class="f"><span>เฟรมที่วิเคราะห์ต่อวินาที (1–10) — สูง = ติดตามละเอียดขึ้น แต่ช้าลง</span><input type="number" name="sampleFps" min="1" max="10" step="1" value="${s.sampleFps}"></label>
        <label class="f"><span>ค่าความมั่นใจต่ำสุดของตัวตรวจจับ (0.15–0.9) — ต่ำ = เจอมากขึ้น แต่ผิดพลาดมากขึ้น</span><input type="number" name="minConfidence" min="0.15" max="0.9" step="0.05" value="${s.minConfidence}"></label>
        <label class="f"><span>เกณฑ์เตือนคนหนาแน่น (จำนวนคนในภาพพร้อมกัน, 0 = ปิด)</span><input type="number" name="crowdThreshold" min="0" max="200" step="1" value="${s.crowdThreshold}"></label>
        <button class="btn pri">บันทึก</button></form>`
      $('#f', root).onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { try { await put('/settings', Object.fromEntries(new FormData(e.target))); toast('บันทึกแล้ว ใช้กับการวิเคราะห์ครั้งต่อไป') } catch (x) { toast(x.message, true) } }) }
    } else {
      const { audit } = await get('/settings/audit?limit=300')
      c.innerHTML = `<div class="tw"><table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead><tbody>${audit.map((a) => `<tr><td class="xs mono" style="white-space:nowrap">${dt(a.at)}</td><td>${esc(a.username)}</td><td class="mono sm">${esc(a.action)}</td><td class="xs mut ell">${esc(a.detail ? JSON.stringify(a.detail) : '')}</td></tr>`).join('')}</tbody></table></div>`
    }
    $$('[data-t]', root).forEach((b) => b.onclick = () => { tab = b.dataset.t; draw() })
  }
  await draw()
}
