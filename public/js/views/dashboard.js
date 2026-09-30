import { get } from '../api.js'
import { esc, vpill, EVT, dur, dt, $ } from '../ui.js'

const MODULES = [
  ['นับคนและยานพาหนะ', 'พร้อมใช้', 'ติดตามทีละคัน/คน นับพร้อมกันในภาพ และแผนที่ความหนาแน่น', true],
  ['โซนหวงห้าม', 'พร้อมใช้', 'วาดพื้นที่บนภาพ แจ้งเมื่อมีคนเข้าหรืออยู่นานเกินกำหนด', true],
  ['นับข้ามเส้น', 'พร้อมใช้', 'นับเข้า/ออกที่ประตูหรือทางเดิน แยกคนกับยานพาหนะ', true],
  ['ตรวจ PPE (หมวก/เสื้อสะท้อนแสง)', 'ยังไม่เปิด', 'ต้องมีโมเดลและข้อมูลฝึกที่ license ใช้เชิงพาณิชย์ได้ ยังไม่ติดตั้งเพื่อไม่ให้โชว์ผลที่ไม่จริง', false],
  ['จดจำใบหน้า', 'ยังไม่เปิด', 'ต้องมีข้อตกลงความยินยอมตาม PDPA และชุดข้อมูลที่ถูกต้องก่อน', false],
  ['อ่านป้ายทะเบียน', 'ยังไม่เปิด', 'ต้องมีข้อมูลป้ายทะเบียนไทยสำหรับทดสอบ', false],
]

export async function render(root, { me }) {
  const s = await get('/reports/summary')
  const scope = me.user.role === 'operation'
  root.innerHTML = `<div class="stack">
    ${scope ? '<div class="notice">ตัวเลขนี้เป็นคลิปของคุณเองเท่านั้น</div>' : ''}
    <div class="kpis"><div class="kpi hot"><div class="l">คลิปที่วิเคราะห์แล้ว</div><div class="v mono">${s.done}<span class="mut" style="font-size:15px"> / ${s.total}</span></div></div>
      <div class="kpi"><div class="l">คนที่ติดตามได้ (รวมทุกคลิป)</div><div class="v mono">${s.persons}</div></div>
      <div class="kpi"><div class="l">ยานพาหนะที่ติดตามได้</div><div class="v mono">${s.vehicles}</div></div>
      <a class="kpi" href="#/videos" style="text-decoration:none;color:inherit"><div class="l">แจ้งเตือนระดับสูง${s.running ? ` · กำลังประมวลผล ${s.running}` : ''}</div><div class="v mono" style="color:${s.alerts ? 'var(--bad)' : 'inherit'}">${s.alerts}</div></a></div>
    ${s.total ? '' : '<div class="card"><h2>เริ่มต้นใช้งาน</h2><ol class="flow"><li><b>อัปโหลดคลิป</b><div class="sm mut">ไฟล์จากกล้องวงจรปิด หรือคลิปที่ถ่ายเองและมีสิทธิ์ใช้งาน</div></li><li><b>วาดโซนหรือเส้นนับบนภาพ</b><div class="sm mut">ลากบนภาพตัวอย่างของคลิปเอง</div></li><li><b>ดูผลและถามระบบ</b><div class="sm mut">กรอบตรวจจับบนวิดีโอ กราฟคน เหตุการณ์ และถามเป็นภาษาไทย</div></li></ol><div class="row" style="margin-top:8px"><a class="btn pri" href="#/upload">อัปโหลดคลิปแรก</a></div></div>'}
    <div class="cols"><div class="card"><div class="hd"><h2>คลิปล่าสุด</h2><a class="btn sm" href="#/videos">ดูทั้งหมด</a></div>
      ${s.recent.length ? `<div class="q">${s.recent.map((v) => `<a class="qi click" href="#/video/${v.id}" style="text-decoration:none;color:inherit"><div><b>${esc(v.name)}</b><div class="xs mut">${v.customer ? esc(v.customer) + ' · ' : ''}${v.duration ? dur(v.duration) + ' · ' : ''}${dt(v.createdAt)}</div></div>${vpill(v.status)}</a>`).join('')}</div>` : '<div class="empty">ยังไม่มีคลิป</div>'}</div>
      <div class="card"><h2>เหตุการณ์ที่ตรวจพบ</h2>${s.byType.length ? s.byType.map((t) => `<div class="hbar"><span class="nm">${esc(EVT[t.type]?.[1] || t.type)}</span><span class="mono" style="text-align:right">${t.n}</span><span class="tr"><i style="width:${(t.n / Math.max(...s.byType.map((x) => x.n))) * 100}%"></i></span></div>`).join('') : '<div class="empty">ยังไม่มีเหตุการณ์</div>'}</div></div>
    <div class="card"><h2>โมดูล</h2><div class="mods">${MODULES.map(([n, st, d, on]) => `<div class="mod ${on ? '' : 'off'}"><h3>${n}<span class="pill ${on ? 'green' : 'grey'}">${st}</span></h3><div class="sm mut">${d}</div></div>`).join('')}</div>
      <p class="sm mut" style="margin:12px 0 0">ตัวเลขเป็นผลที่ระบบติดตามได้ในคลิปนั้น ไม่ใช่ตัวเลขความแม่นยำ ความแม่นยำขึ้นกับตำแหน่งกล้อง แสง และมุมภาพ ต้องทดสอบกับภาพจริงของลูกค้าก่อนสรุป</p></div></div>`
}
