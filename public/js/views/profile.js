import { post } from '../api.js'
import { $, esc, toast, busy, ROLE } from '../ui.js'

export async function render(root, { me }) {
  const u = me.user
  root.innerHTML = `<div class="stack" style="max-width:480px"><div class="card"><h2>${esc(u.displayName)}</h2><p class="mut" style="margin:4px 0 0">@${esc(u.username)} · <span class="pill role">${ROLE[u.role]}</span></p></div>
    <form class="card" id="f"><h2>เปลี่ยนรหัสผ่าน</h2><label class="f"><span>รหัสผ่านปัจจุบัน</span><input type="password" name="current" required autocomplete="current-password"></label>
    <label class="f"><span>รหัสผ่านใหม่ (≥ 10 ตัวอักษร)</span><input type="password" name="next" required autocomplete="new-password"></label><button class="btn pri">บันทึก</button></form>
    <p class="sm mut">เปลี่ยนรหัสแล้ว อุปกรณ์อื่นที่ล็อกอินอยู่จะถูกออกจากระบบ</p></div>`
  $('#f', root).onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { try { await post('/auth/change-password', Object.fromEntries(new FormData(e.target))); toast('เปลี่ยนรหัสผ่านแล้ว'); e.target.reset() } catch (x) { toast(x.message, true) } }) }
}
