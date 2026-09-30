import { get, post, patch } from '../api.js'
import { esc, dt, toast, ROLE, ask } from '../ui.js'

export async function render(root, { me }) {
  async function draw() {
    const { users } = await get('/users')
    root.innerHTML = `<div class="stack"><div class="row"><button class="btn pri" id="new">+ เพิ่มผู้ใช้</button></div>
    <div class="notice"><b>สิทธิ์</b> · <b>Admin</b> ตั้งค่าระบบ/ผู้ใช้ ดูทุกอย่าง · <b>MD</b> ดูและแก้ทุกคลิป ดูผลของทุกเซลล์ · <b>Operation</b> เห็นและแก้เฉพาะคลิปที่ตัวเองอัปโหลด</div>
    <div class="tw"><table><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>สิทธิ์</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.displayName)}</td><td><select data-role="${u.id}" aria-label="สิทธิ์ของ ${esc(u.username)}" style="width:auto">${['admin', 'md', 'operation'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select></td>
      <td>${u.active ? '<span class="pill green">ใช้งาน</span>' : '<span class="pill grey">ปิด</span>'}</td><td class="sm mut">${u.lastLoginAt ? dt(u.lastLoginAt) : '—'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="${u.id}">${u.active ? 'ปิดบัญชี' : 'เปิดบัญชี'}</button> <button class="btn sm" data-pw="${u.id}">ตั้งรหัสใหม่</button></td></tr>`).join('')}</tbody></table></div></div>`
    root.querySelector('#new').onclick = async () => {
      const v = await ask('เพิ่มผู้ใช้', `<label class="f"><span>ชื่อผู้ใช้ (ตัวอักษร/ตัวเลข . _ -)</span><input type="text" name="username" required autocomplete="off"></label><label class="f"><span>ชื่อที่แสดง</span><input type="text" name="displayName"></label>
        <label class="f"><span>สิทธิ์</span><select name="role"><option value="operation">Operation</option><option value="md">MD</option><option value="admin">Admin</option></select></label><label class="f"><span>รหัสผ่านเริ่มต้น (≥ 10 ตัว — ให้ผู้ใช้เปลี่ยนเองภายหลัง)</span><input type="password" name="password" required autocomplete="new-password"></label>`)
      if (!v) return; try { await post('/users', v); toast('เพิ่มผู้ใช้แล้ว'); draw() } catch (e) { toast(e.message, true) }
    }
    root.onchange = async (e) => { const s = e.target.closest('[data-role]'); if (!s) return; try { await patch('/users/' + s.dataset.role, { role: s.value }); toast('เปลี่ยนสิทธิ์แล้ว') } catch (x) { toast(x.message, true) } draw() }
    root.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return
      if (b.dataset.act) { const u = users.find((x) => x.id === b.dataset.act); try { await patch('/users/' + u.id, { active: !u.active }); draw() } catch (x) { toast(x.message, true) } }
      if (b.dataset.pw) { const v = await ask('ตั้งรหัสผ่านใหม่', '<label class="f"><span>รหัสผ่านใหม่ (≥ 10 ตัว)</span><input type="password" name="password" required autocomplete="new-password"></label>'); if (!v) return; try { await post(`/users/${b.dataset.pw}/reset-password`, v); toast('ตั้งรหัสผ่านใหม่แล้ว ผู้ใช้ต้องเข้าสู่ระบบใหม่') } catch (x) { toast(x.message, true) } }
    }
  }
  await draw()
}
